import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { parsePuzzles } from "@/game/puzzles";
// The same data as SAMPLE_PUZZLES; see practice.spec.ts for why it's a JSON import.
import sample from "@/puzzles/sample.json" with { type: "json" };

// Accessibility (#49): WCAG 2.2 AA on every screen, in light and dark mode.
//
// - axe-core checks the WCAG 2.0, 2.1 and 2.2 A and AA rules it can test
//   automatically (names, roles, labels, contrast it can compute, ...).
// - A font-size check: no visible text smaller than 12 px.
// - Right and wrong are never shown by color alone: each has words and a
//   symbol, also with colors removed (Chromium's achromatopsia emulation).
// - A full keyboard-only playthrough.
// Text contrast is also measured on the rendered page in contrast.spec.ts
// (#89). What a person still checks by hand is listed in #49.
//
// The game and account screens need a database (Server Actions + Postgres),
// as in practice.spec.ts.

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const MIN_FONT_PX = 12;

const puzzles = parsePuzzles(sample);
const first = puzzles[0]!;

async function expectNoAxeViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).join("\n    ")}`,
  );
  expect(summary, `axe found WCAG problems on ${screen}`).toEqual([]);
}

/** Every visible text smaller than MIN_FONT_PX, as `14px "text"`. */
async function tinyText(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const found = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el || !el.checkVisibility()) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < min) found.add(`${size}px "${text.slice(0, 40)}"`);
    }
    return [...found];
  }, MIN_FONT_PX);
}

async function checkScreen(page: Page, screen: string) {
  await expectNoAxeViolations(page, screen);
  expect(await tinyText(page), `text smaller than ${MIN_FONT_PX}px on ${screen}`).toEqual([]);
}

const guessBox = (page: Page) => page.getByRole("textbox", { name: "What is it?" });

async function guess(page: Page, text: string) {
  await guessBox(page).fill(text);
  await page.getByRole("button", { name: "Guess", exact: true }).click();
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme });
    });

    test("home, log-in, sign-up (with errors) and not-found screens meet WCAG 2.2 AA", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
      await checkScreen(page, "home");

      await page.goto("/login");
      await checkScreen(page, "log in");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
      await checkScreen(page, "log in with errors");

      await page.goto("/register");
      await checkScreen(page, "sign up");
      await page.getByLabel("Username").fill("someone@example.com");
      await page.getByLabel("Password").fill("short");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
      await checkScreen(page, "sign up with errors");

      await page.goto("/no-such-page");
      await checkScreen(page, "not found");
    });

    test("every game screen meets WCAG 2.2 AA: playing, wrong, zoomed out, right, final score", async ({ page }) => {
      await page.goto("/play");
      await expect(guessBox(page)).toBeVisible();
      await checkScreen(page, "game, first image");
      // The image has a text alternative, and it never gives the answer away.
      const alt = (await page.getByRole("img", { name: /mystery image/i }).getAttribute("alt")) ?? "";
      for (const answer of [first.answer, ...first.acceptedAnswers]) {
        expect(alt.toLowerCase()).not.toContain(answer.toLowerCase());
      }

      await guess(page, "definitely not it");
      await expect(page.getByRole("status")).not.toBeEmpty();
      await checkScreen(page, "game, after a wrong guess");

      await page.getByRole("button", { name: "Zoom out" }).click();
      await checkScreen(page, "game, zoomed out");

      await guess(page, first.answer);
      await expect(page.getByRole("button", { name: /Next image|See results/ })).toBeVisible();
      await checkScreen(page, "game, after a right guess");

      // Skip the rest to reach the final score.
      for (let i = 1; i < puzzles.length; i++) {
        await page.getByRole("button", { name: /Next image/ }).click();
        await page.getByRole("button", { name: "Skip this image" }).click();
      }
      await page.getByRole("button", { name: /See results/ }).click();
      await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
      await checkScreen(page, "final score");
    });

    test("the account screens meet WCAG 2.2 AA when logged in", async ({ page }) => {
      const username = `a11y_${colorScheme}_${Date.now().toString(36)}`.slice(0, 20);
      await page.goto("/register");
      await page.getByLabel("Username").fill(username);
      await page.getByLabel("Password").fill("a long test password");
      await page.getByRole("button", { name: "Create account" }).click();
      const site = page.getByRole("navigation", { name: "Site" });
      await expect(site.getByRole("button", { name: "Log out" })).toBeVisible();
      await checkScreen(page, "after signing up (logged-in header)");

      await page.goto("/account");
      await expect(page.getByText(username)).toBeVisible();
      await checkScreen(page, "account");
    });
  });
}

test("right and wrong are told apart by words and symbols, not only color, even with colors removed", async ({ page }) => {
  // Chromium's vision-deficiency emulation: achromatopsia shows no color at all.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedVisionDeficiency", { type: "achromatopsia" });

  await page.goto("/play");
  await guess(page, "definitely not it");
  const wrong = (await page.getByRole("status").innerText()).trim();

  await guess(page, first.answer);
  const right = (await page.getByRole("status").innerText()).trim();

  // Each message is words, and the two differ in their words, so nobody needs color to tell them apart.
  expect(wrong).toMatch(/[a-z]{3,}/i);
  expect(right).toMatch(/[a-z]{3,}/i);
  expect(right).not.toBe(wrong);
  // The ✓ / ✗ symbols are shown next to the field (aria-hidden, since the text already says it).
  await expect(page.getByText("✓").first()).toBeVisible();
});

test("a whole game can be played from the keyboard alone", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  // Home link, Log in, then Start practice.
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Start practice" })).toBeFocused();
  await page.keyboard.press("Enter");

  for (const [i, puzzle] of puzzles.entries()) {
    // The guess box has focus at the start of every round.
    await expect(guessBox(page)).toBeFocused();
    if (i === 0) {
      // Reach Zoom out with Shift+Tab and use it, then come back to the guess box.
      for (let n = 0; n < 6 && !(await page.getByRole("button", { name: "Zoom out" }).evaluate((el) => el === document.activeElement)); n++) {
        await page.keyboard.press("Shift+Tab");
      }
      await expect(page.getByRole("button", { name: "Zoom out" })).toBeFocused();
      await page.keyboard.press("Enter");
      for (let n = 0; n < 6 && !(await guessBox(page).evaluate((el) => el === document.activeElement)); n++) {
        await page.keyboard.press("Tab");
      }
      await expect(guessBox(page)).toBeFocused();
    }
    await page.keyboard.type(puzzle.answer);
    await page.keyboard.press("Enter");
    // The next step gets focus, so Enter moves on.
    const next = page.getByRole("button", { name: i === puzzles.length - 1 ? "See results" : "Next image" });
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
});
