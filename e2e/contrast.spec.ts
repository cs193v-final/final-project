import { expect, test, type Page } from "@playwright/test";
import { parsePuzzles } from "@/game/puzzles";
// The same data as SAMPLE_PUZZLES; see practice.spec.ts for why it's a JSON import.
import sample from "@/puzzles/sample.json" with { type: "json" };

const count = parsePuzzles(sample).length;

// Text contrast, WCAG 2.2 AA (1.4.3), on every screen of the practice flow, in
// light and dark mode (#89). Checks the colors Chromium actually renders: each
// visible text's color against the nearest opaque background behind it.
// Needs 4.5:1, or 3:1 for large text (24 px, or bold 18.66 px).

/** Every visible text on the page that fails AA, as "4.39:1 (needs 4.5) "skipped"". */
async function contrastFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Turn any CSS color (oklch, rgb, …) into sRGB by painting one canvas pixel.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const toRgba = (color: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const luminance = (rgb: number[]) => {
      const channel = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
    };
    const backgroundOf = (start: Element) => {
      for (let el: Element | null = start; el; el = el.parentElement) {
        const color = toRgba(getComputedStyle(el).backgroundColor);
        if (color[3] > 0.99) return color;
      }
      return toRgba(getComputedStyle(document.documentElement).backgroundColor);
    };

    const failures = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || !el.checkVisibility()) continue;
      const style = getComputedStyle(el);
      const fg = toRgba(style.color);
      const bg = backgroundOf(el);
      const shown = [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])); // text opacity over its background
      const [hi, lo] = [luminance(shown), luminance(bg)].sort((a, b) => b - a);
      const ratio = (hi! + 0.05) / (lo! + 0.05);
      const size = parseFloat(style.fontSize);
      const needed = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
      if (ratio < needed) failures.add(`${ratio.toFixed(2)}:1 (needs ${needed}) "${text.slice(0, 40)}"`);
    }
    return [...failures];
  });
}

/**
 * Every visible control whose look depends on a border or a background, but
 * that doesn't stand out 3:1 from what's behind it (WCAG 1.4.11 Non-text
 * Contrast): `"Zoom out" border 1.53:1`. Text-only controls (links, quiet
 * buttons) are named by their text, which the check above covers.
 */
async function boundaryFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const toRgba = (color: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const luminance = (rgb: number[]) => {
      const channel = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const backgroundBehind = (start: Element | null) => {
      for (let el = start; el; el = el.parentElement) {
        const color = toRgba(getComputedStyle(el).backgroundColor);
        if (color[3] > 0.99) return color;
      }
      return toRgba(getComputedStyle(document.documentElement).backgroundColor);
    };

    const failures: string[] = [];
    for (const el of document.querySelectorAll("button, input, select, textarea")) {
      if (!el.checkVisibility()) continue;
      const style = getComputedStyle(el);
      const behind = backgroundBehind(el.parentElement);
      const own = toRgba(style.backgroundColor);
      const hasBorder = parseFloat(style.borderTopWidth) > 0 && toRgba(style.borderTopColor)[3] > 0;
      const hasFill = own[3] > 0.99 && ratio(own, behind) > 1.05;
      if (!hasBorder && !hasFill && el.tagName === "BUTTON") continue; // a text-only button
      const best = Math.max(hasFill ? ratio(own, behind) : 1, hasBorder ? ratio(toRgba(style.borderTopColor), behind) : 1);
      const name = el.getAttribute("aria-label") ?? (el.textContent?.trim() || (el as HTMLInputElement).name || el.tagName.toLowerCase());
      if (best < 3) failures.push(`"${name.slice(0, 30)}" ${hasBorder ? "border" : "background"} ${best.toFixed(2)}:1`);
    }
    return failures;
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`text and controls meet WCAG AA contrast on home, play and the final score (${colorScheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });

    await page.goto("/");
    expect(await contrastFailures(page), "home").toEqual([]);
    expect(await boundaryFailures(page), "home controls").toEqual([]);

    await page.getByRole("link", { name: "Start practice" }).click();
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
    expect(await contrastFailures(page), "play").toEqual([]);
    // The guess box, Guess and Zoom out are outlined or filled: 3:1 against the page (1.4.11).
    expect(await boundaryFailures(page), "play controls").toEqual([]);

    // Skip every image to reach the final score, with "skipped" on every row.
    for (let i = 1; i <= count; i++) {
      await expect(page.getByText(`Image ${i} of ${count}`)).toBeVisible();
      await page.getByRole("button", { name: "Skip this image" }).click();
      await page.getByRole("button", { name: i === count ? "See results" : "Next image" }).click();
    }
    await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
    expect(await contrastFailures(page), "final score").toEqual([]);
  });
}
