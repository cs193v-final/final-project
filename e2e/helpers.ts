import { expect, type Page } from "@playwright/test";
import { GAME_NAME } from "@/site";

// Helpers shared by the e2e specs, so each one (and the brittle tab order) has
// one copy. Not a spec: Playwright only runs `*.spec.ts`.

/** The header's navigation, on every page. */
export const siteNav = (page: Page) => page.getByRole("navigation", { name: "Site" });

/** The header's link home. */
export const homeLink = (page: Page) => siteNav(page).getByRole("link", { name: `${GAME_NAME} home` });

/** "Skip to content", the first thing Tab reaches on every page (layout.tsx). */
export const skipLink = (page: Page) => page.getByRole("link", { name: "Skip to content" });

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
 * Skip every remaining image to reach the final score screen. Call it while an
 * image is being played. After each skip, wait for the button that ends the
 * round: with server-side games (#54) it only appears once the server has
 * answered, so checking right away would miss it.
 */
export async function finishPractice(page: Page) {
  for (;;) {
    await page.getByRole("button", { name: "Skip this image" }).click();
    const after = page.getByRole("button", { name: /^(Next image|See results)$/ });
    await expect(after).toBeVisible();
    // By accessible name, not raw text: the button also holds a decorative arrow (#183).
    const last = (await page.getByRole("button", { name: "See results" }).count()) > 0;
    await after.click();
    if (last) break;
  }
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
}

/**
 * Open the home screen and Tab to Start practice: Skip to content, the home
 * link, Leaderboard (#62), Log in (#53), then the playable modes, Daily (#58),
 * Stanford (#65) and then Practice (coming-soon cards are skipped). Leaves
 * focus on Start practice.
 */
export async function tabToStartPractice(page: Page) {
  await page.goto("/");
  await waitForAccountLinks(page);
  await page.keyboard.press("Tab");
  await expect(skipLink(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(homeLink(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(siteNav(page).getByRole("link", { name: "Leaderboard" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(siteNav(page).getByRole("link", { name: "Log in" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Play today's" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Play Stanford" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Start practice" })).toBeFocused();
}

/**
 * The security headers every page sends (#105). Shared by
 * security-headers.spec.ts and the smoke test of a deployed site (#223).
 */
export function expectSecurityHeaders(headers: Record<string, string>) {
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toMatch(/^max-age=\d+/);
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
}

/** Collects the browser's CSP violation reports for a page. */
export function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

/** In the page: what a check reports for one visible text, or nothing if it's fine. */
export type TextCheck = (el: Element, text: string) => string | null | undefined;

/**
 * Walk every visible, non-empty text on the page and return what `setup`'s
 * check reports, without duplicates. "Visible" skips text hidden by
 * `display`, `visibility` or `opacity: 0`. What's typed in a text field
 * counts as text; placeholders don't (they're styled by `::placeholder`,
 * which `getComputedStyle(el)` doesn't return). `setup` runs once in the page
 * with `arg` and returns the check. Both are sent to the browser as source, so they can
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
  // Inside the function: it's sent to the page as source, without this module.
  const VISIBLE = { visibilityProperty: true, opacityProperty: true };
  const check = setup(arg);
  const found = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const el = node.parentElement;
    if (!text || !el || !el.checkVisibility(VISIBLE)) continue;
    const result = check(el, text);
    if (result) found.add(result);
  }
  // Text fields only: a checkbox's or a button's `value` isn't shown as typed text.
  const TEXT_FIELDS = "textarea, input:not([type]), input:is([type=text], [type=search], [type=email], [type=url], [type=tel], [type=number], [type=password])";
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TEXT_FIELDS)) {
    const text = field.value.trim();
    if (!text || !field.checkVisibility(VISIBLE)) continue;
    const result = check(field, text);
    if (result) found.add(result);
  }
  return [...found];
}
