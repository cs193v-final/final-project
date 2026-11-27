import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { usernameIndex } from "@/auth/user-row";
import { Vault } from "@/crypto/vault";
import { parsePuzzles } from "@/game/puzzles";
// The same data as SAMPLE_PUZZLES; see practice.spec.ts for why it's a JSON import.
import sample from "@/puzzles/sample.json" with { type: "json" };
import {
  checkVisibleText,
  finishPractice,
  guess,
  guessBox,
  siteNav,
  tabToStartPractice,
  waitForAccountLinks,
} from "./helpers";

// Accessibility (#49): WCAG 2.2 AA on every screen, in light and dark mode.
//
// - axe-core checks the WCAG 2.0, 2.1 and 2.2 A and AA rules it can test
//   automatically (names, roles, labels, contrast it can compute, ...).
// - A font-size check: no visible text smaller than 12 px.
// - Right and wrong are never shown by color alone: each has its own words and
//   symbol (✓ / ✗). Whether the colors themselves are told apart by people with
//   color blindness was checked by hand (#49); this test doesn't look at color.
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
function tinyText(page: Page): Promise<string[]> {
  return checkVisibleText(
    page,
    (min: number) => (el: Element, text: string) => {
      const size = parseFloat(getComputedStyle(el).fontSize);
      return size < min ? `${size}px "${text.slice(0, 40)}"` : null;
    },
    MIN_FONT_PX,
  );
}

async function checkScreen(page: Page, screen: string) {
  await expectNoAxeViolations(page, screen);
  expect(await tinyText(page), `text smaller than ${MIN_FONT_PX}px on ${screen}`).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test("home, leaderboard, log-in, sign-up (with errors) and not-found screens meet WCAG 2.2 AA", async ({ page }) => {
      // Each screen waits for the header's Log in link, which streams in after the page shell.
      await page.goto("/");
      await waitForAccountLinks(page);
      await checkScreen(page, "home");

      await page.goto("/leaderboard");
      await waitForAccountLinks(page);
      await expect(page.getByText(/only logged-in players/i)).toBeVisible(); // the board has loaded, not the fallback
      await checkScreen(page, "leaderboard");

      await page.goto("/login");
      await waitForAccountLinks(page);
      await checkScreen(page, "log in");
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
      await checkScreen(page, "log in with errors");

      await page.goto("/register");
      await waitForAccountLinks(page);
      await checkScreen(page, "sign up");
      await page.getByLabel("Username").fill("someone@example.com");
      await page.getByLabel("Password").fill("short");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
      await checkScreen(page, "sign up with errors");

      await page.goto("/no-such-page");
      await waitForAccountLinks(page);
      await checkScreen(page, "not found");
    });

    test("every game screen meets WCAG 2.2 AA: playing, wrong, zoomed out, right, final score", async ({ page }) => {
      await page.goto("/play");
      await expect(guessBox(page)).toBeVisible();
      await waitForAccountLinks(page); // so the header is audited too
      await checkScreen(page, "game, first image");
      // The image has a text alternative, and it never gives the answer away.
      const alt = (await page.getByRole("img", { name: /mystery image/i }).getAttribute("alt")) ?? "";
      for (const answer of [first.answer, ...first.acceptedAnswers]) {
        expect(alt.toLowerCase()).not.toContain(answer.toLowerCase());
      }

      await guess(page, "definitely not it");
      await expect(page.getByRole("main").getByRole("status")).not.toBeEmpty();
      await checkScreen(page, "game, after a wrong guess");

      await page.getByRole("button", { name: "Zoom out" }).click();
      // Audit the new level, not the in-between state while the server answers.
      await expect(page.getByText(/^Zoom level 2 of /)).toBeVisible();
      await checkScreen(page, "game, zoomed out");

      await guess(page, first.answer);
      await expect(page.getByRole("button", { name: /Next image|See results/ })).toBeVisible();
      await checkScreen(page, "game, after a right guess");

      // Skip the rest to reach the final score.
      await page.getByRole("button", { name: "Next image" }).click();
      await finishPractice(page);
      await checkScreen(page, "final score");
    });

    test("the account screens meet WCAG 2.2 AA when logged in", async ({ page }, testInfo) => {
      // It signs up a real user, so it deletes it afterwards, which needs the
      // database and the key in this process's environment (CI sets both). A
      // plain local run skips it rather than leave accounts in a shared database.
      const url = process.env.DATABASE_URL;
      test.skip(!url || !process.env.DATA_ENCRYPTION_KEY, "needs DATABASE_URL and DATA_ENCRYPTION_KEY to clean up its user");

      // Unique across color schemes, projects (desktop and phone run in parallel
      // against one database), workers and runs: 4 + 2 + at most 3 + 1 + 8 = at
      // most 18 characters (the limit is 20), letters, digits and _ only.
      const where = `${colorScheme[0]}${testInfo.project.name[0]}${testInfo.workerIndex % 1000}`;
      const username = `a11y${where}_${randomBytes(4).toString("hex")}`;
      try {
        await page.goto("/register");
        await page.getByLabel("Username").fill(username);
        await page.getByLabel("Password").fill("a long test password");
        await page.getByRole("button", { name: "Create account" }).click();
        // Sign-up redirects. Wait until the new page is in place, not just its
        // header: "Log out" can show before the navigation ends, and axe would
        // then see a document without its <title> (flaky in CI on #134).
        await expect(page).not.toHaveURL(/\/register/);
        await expect(page).toHaveTitle(/\S/);
        await expect(siteNav(page).getByRole("button", { name: "Log out" })).toBeVisible();
        await checkScreen(page, "after signing up (logged-in header)");

        await page.goto("/account");
        await expect(page.getByRole("main").getByText(`Signed in as ${username}.`)).toBeVisible();
        await checkScreen(page, "account");
      } finally {
        // Found by the same keyed hash login uses; sessions and games cascade.
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        try {
          await client.query("DELETE FROM users WHERE username_index = $1", [usernameIndex(Vault.fromEnv(), username)]);
        } finally {
          await client.end();
        }
      }
    });
  });
}

test("right and wrong are told apart by their words and a symbol, not only by color", async ({ page }) => {
  // This checks the cues that don't depend on color. It doesn't look at the
  // colors themselves (that was checked by hand with a colorblind simulator, #49).
  await page.goto("/play");
  await waitForAccountLinks(page);
  // The game's own status; the header has one too (the login confirmation, #134).
  const status = page.getByRole("main").getByRole("status");

  await guess(page, "definitely not it");
  await expect(status).toContainText("isn't it (1 wrong guess)");
  await expect(status.getByText("✗", { exact: true })).toBeVisible();
  await expect(status).not.toContainText("✓");

  await guess(page, first.answer);
  await expect(status).toContainText(`Correct! It's ${first.answer}.`);
  await expect(status.getByText("✓", { exact: true })).toBeVisible();
  await expect(status).not.toContainText("✗");
});

test("a whole game can be played from the keyboard alone", async ({ page }) => {
  await tabToStartPractice(page);
  await page.keyboard.press("Enter");

  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  for (const [i, puzzle] of puzzles.entries()) {
    // The guess box has focus at the start of every round.
    await expect(guessBox(page)).toBeFocused();
    if (i === 0) {
      // Reach Zoom out with Shift+Tab and use it, then come back to the guess box.
      for (let n = 0; n < 6 && !(await zoomOut.evaluate((el) => el === document.activeElement)); n++) {
        await page.keyboard.press("Shift+Tab");
      }
      await expect(zoomOut).toBeFocused();
      await page.keyboard.press("Enter");
      // Wait for the server to answer: while a move is pending, a guess is dropped.
      await expect(page.getByText(/^Zoom level 2 of /)).toBeVisible();
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
