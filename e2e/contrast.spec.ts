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

for (const colorScheme of ["light", "dark"] as const) {
  test(`all text meets WCAG AA contrast on home, play and the final score (${colorScheme} mode)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });

    await page.goto("/");
    expect(await contrastFailures(page), "home").toEqual([]);

    await page.getByRole("link", { name: "Start practice" }).click();
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
    expect(await contrastFailures(page), "play").toEqual([]);

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
