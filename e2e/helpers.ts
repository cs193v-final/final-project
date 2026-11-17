import { expect, type Page } from "@playwright/test";
import { GAME_NAME } from "@/site";

// Helpers shared by the e2e specs, so each one (and the brittle tab order) has
// one copy. Not a spec: Playwright only runs `*.spec.ts`.

/** The header's navigation, on every page. */
export const siteNav = (page: Page) => page.getByRole("navigation", { name: "Site" });

/** The header's link home. */
export const homeLink = (page: Page) => siteNav(page).getByRole("link", { name: `${GAME_NAME} home` });

/**
 * Wait for the header's "Log in" link (logged out). It streams in after the
 * page shell (it reads the session cookie), so tab order and page-wide checks
 * wait for it.
 */
export async function waitForAccountLinks(page: Page) {
  await expect(siteNav(page).getByRole("link", { name: "Log in" })).toBeVisible();
}

export const guessBox = (page: Page) => page.getByRole("textbox", { name: "What is it?" });

export async function guess(page: Page, text: string) {
  await guessBox(page).fill(text);
  await page.getByRole("button", { name: "Guess", exact: true }).click();
}

/**
 * Open the home screen and Tab to Start practice: the home link, Log in (#53),
 * then the only playable mode (coming-soon cards are skipped). Leaves focus on
 * Start practice.
 */
export async function tabToStartPractice(page: Page) {
  await page.goto("/");
  await waitForAccountLinks(page);
  await page.keyboard.press("Tab");
  await expect(homeLink(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(siteNav(page).getByRole("link", { name: "Log in" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Start practice" })).toBeFocused();
}

/** In the page: what a check reports for one visible text, or nothing if it's fine. */
export type TextCheck = (el: Element, text: string) => string | null | undefined;

/**
 * Walk every visible, non-empty text on the page and return what `setup`'s
 * check reports, without duplicates. `setup` runs once in the page with `arg`
 * and returns the check. Both are sent to the browser as source, so they can
 * only use their arguments and browser globals, not anything from this file.
 */
export async function checkVisibleText<A>(page: Page, setup: (arg: A) => TextCheck, arg: A): Promise<string[]> {
  // A string expression, so `setup` arrives as a function and not as data.
  return (await page.evaluate(
    `(${walkVisibleText.toString()})(${setup.toString()}, ${JSON.stringify(arg) ?? "undefined"})`,
  )) as string[];
}

/** Runs in the page (see checkVisibleText). */
function walkVisibleText(setup: (arg: unknown) => TextCheck, arg: unknown): string[] {
  const check = setup(arg);
  const found = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const el = node.parentElement;
    if (!text || !el || !el.checkVisibility()) continue;
    const result = check(el, text);
    if (result) found.add(result);
  }
  return [...found];
}
