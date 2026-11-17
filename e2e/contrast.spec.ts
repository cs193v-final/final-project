import { expect, test, type Page } from "@playwright/test";
import { checkVisibleText, finishPractice } from "./helpers";

// Text contrast, WCAG 2.2 AA (1.4.3), on every screen of the practice flow, in
// light and dark mode (#89). Checks the colors Chromium actually renders: each
// visible text's color against the nearest opaque background behind it.
// Needs 4.5:1, or 3:1 for large text (24 px, or bold 18.66 px).

type Rgba = [number, number, number, number];
/** The color math both checks use, installed in the page as `window.__contrast`. */
type ColorTools = {
  /** Any CSS color (oklch, rgb, …) as sRGB 0–255 plus alpha 0–1. */
  toRgba: (color: string) => Rgba;
  /** WCAG contrast ratio between two opaque colors. */
  ratio: (a: number[], b: number[]) => number;
  /** The nearest opaque background at or above `start`, else the page's. */
  backgroundOf: (start: Element | null) => Rgba;
};
declare global {
  interface Window {
    __contrast: ColorTools;
  }
}

/**
 * Install `window.__contrast` in the page, so the text and the control checks
 * compute colors the one same way. Runs in the page, so it uses only browser
 * globals.
 */
async function installColorTools(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Turn any CSS color into sRGB by painting one canvas pixel.
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const toRgba = (color: string): Rgba => {
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
    const backgroundOf = (start: Element | null) => {
      for (let el = start; el; el = el.parentElement) {
        const color = toRgba(getComputedStyle(el).backgroundColor);
        if (color[3] > 0.99) return color;
      }
      return toRgba(getComputedStyle(document.documentElement).backgroundColor);
    };
    window.__contrast = { toRgba, ratio, backgroundOf };
  });
}

/** Every visible text on the page that fails AA, as "4.39:1 (needs 4.5) "skipped"". */
async function contrastFailures(page: Page): Promise<string[]> {
  await installColorTools(page);
  return checkVisibleText(
    page,
    () => {
      const { toRgba, ratio, backgroundOf } = window.__contrast;
      return (el: Element, text: string) => {
        const style = getComputedStyle(el);
        const fg = toRgba(style.color);
        const bg = backgroundOf(el);
        const shown = [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])); // text opacity over its background
        const contrast = ratio(shown, bg);
        const size = parseFloat(style.fontSize);
        const needed = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66) ? 3 : 4.5;
        return contrast < needed ? `${contrast.toFixed(2)}:1 (needs ${needed}) "${text.slice(0, 40)}"` : null;
      };
    },
    undefined,
  );
}

/**
 * Every visible control whose look depends on a border or a background, but
 * that doesn't stand out 3:1 from what's behind it (WCAG 1.4.11 Non-text
 * Contrast): `"Zoom out" border 1.53:1`. Text-only controls (links, quiet
 * buttons) are named by their text, which the check above covers.
 */
async function boundaryFailures(page: Page): Promise<string[]> {
  await installColorTools(page);
  return page.evaluate(() => {
    const { toRgba, ratio, backgroundOf } = window.__contrast;
    const failures: string[] = [];
    // `a` covers ButtonLink ("Start practice"); text-only links are skipped below.
    for (const el of document.querySelectorAll("a, button, input, select, textarea")) {
      if (!el.checkVisibility()) continue;
      const style = getComputedStyle(el);
      const behind = backgroundOf(el.parentElement);
      const own = toRgba(style.backgroundColor);
      const hasBorder = parseFloat(style.borderTopWidth) > 0 && toRgba(style.borderTopColor)[3] > 0;
      const hasFill = own[3] > 0.99 && ratio(own, behind) > 1.05;
      // A text-only button or link. A box with neither still fails: nothing shows where it is.
      if (!hasBorder && !hasFill && (el.tagName === "BUTTON" || el.tagName === "A")) continue;
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
    await finishPractice(page);
    expect(await contrastFailures(page), "final score").toEqual([]);
    expect(await boundaryFailures(page), "final score controls").toEqual([]);
  });
}
