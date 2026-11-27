import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { parsePuzzles } from "@/game/puzzles";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { pointsIfCorrect } from "@/game/scoring";
import type { Puzzle } from "@/game/types";
// The same data as SAMPLE_PUZZLES (`@/puzzles`); see practice.spec.ts for the import attribute.
import sample from "@/puzzles/sample.json" with { type: "json" };

// The full flow (#61), backend included: sign up a fresh test user, play the
// whole practice game on the server while logged in (wrong guess, zoom out,
// correct guess, skip → final score → Play again), check the game belongs to
// the account, then log out and back in.
//
// Needs DATABASE_URL pointing at a migrated database with the practice pack
// seeded (README → Testing). CI runs a Postgres service container for this.
// Answers and points come from the puzzle data and SCORING_CONFIG.
//
// The daily challenge isn't playable on main yet (#58 part 2); add it here
// once /daily exists.

const puzzles = parsePuzzles(sample);
const count = puzzles.length;

function puzzleAt(i: number) {
  const p = puzzles[i];
  if (!p) throw new Error(`The practice game needs at least ${i + 1} puzzles`);
  return p;
}

const site = (page: Page) => page.getByRole("navigation", { name: "Site" });
const guessBox = (page: Page) => page.getByRole("textbox", { name: "What is it?" });
// The game's status, not the header's login confirmation (#134).
const status = (page: Page) => page.getByRole("main").getByRole("status");
const score = (page: Page) => page.getByText(/^Score \d+$/);

async function guess(page: Page, text: string) {
  await guessBox(page).fill(text);
  await page.getByRole("button", { name: "Guess", exact: true }).click();
}

/**
 * A username no other run, worker or project has used. The desktop and phone
 * projects run in parallel against one database, and usernames are unique
 * ignoring case, so it mixes in the project, the worker and a random part.
 * 3–20 characters of [A-Za-z0-9_-].
 */
function freshUsername(testInfo: TestInfo): string {
  const project = testInfo.project.name.slice(0, 1) || "x";
  const random = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-5);
  return `e2e-${project}${testInfo.workerIndex}-${time}${random}`.slice(0, 20);
}

/** The header shows `username` with a Log out button. It streams in after the page shell. */
async function expectLoggedInAs(page: Page, username: string) {
  await expect(site(page).getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(site(page).getByRole("link", { name: username, exact: true })).toBeVisible();
}

async function expectLoggedOut(page: Page) {
  await expect(site(page).getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(site(page).getByRole("button", { name: "Log out" })).toHaveCount(0);
}

/** Where `puzzle`'s answer (or an accepted answer) appears in `body`, if anywhere. Case-insensitive. */
function findAnswer(body: string, puzzle: Puzzle): string | undefined {
  const text = body.toLowerCase();
  return [puzzle.answer, ...puzzle.acceptedAnswers].find((a) => text.includes(a.toLowerCase()));
}

/**
 * Records the game's Server Action responses so the test can check, round by
 * round, that none sent the current answer while it was being played. As in
 * practice.spec.ts: streamed bodies aren't kept by Chromium, so each one is
 * fetched through a route. Only game actions go through it (`stop()` before
 * logging out), so account redirects are left to the browser.
 */
async function watchServerActions(page: Page) {
  let pending: string[] = [];
  const handler = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const request = route.request();
    if (request.method() !== "POST" || !(await request.headerValue("next-action"))) return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    pending.push(body);
    await route.fulfill({ response, body });
  };
  await page.route("**/play*", handler);
  return {
    /** Every action response since the last call contains no answer to `puzzle`. */
    async expectNoAnswer(puzzle: Puzzle) {
      const responses = pending;
      pending = [];
      expect(responses.length, "expected Server Action responses to check").toBeGreaterThan(0);
      for (const body of responses) {
        expect(body, "a Server Action response should carry a GameView").toContain('"gameId"');
        const leaked = findAnswer(body, puzzle);
        expect(leaked, `a Server Action response contained "${leaked}" while it was being guessed`).toBeUndefined();
      }
    },
    /** Forget responses that may legitimately contain an answer (the round just ended). */
    skip() {
      pending = [];
    },
    async stop() {
      await page.unroute("**/play*", handler);
    },
  };
}

test("a test user signs up, plays the server game to the end and again, and logs out and back in", async ({
  page,
}, testInfo) => {
  test.skip(count < 3, "the flow below uses three images");
  test.slow(); // sign-up, a whole game, refreshes and a log-in: many server round trips
  const username = freshUsername(testInfo);
  const password = `e2e password ${Math.random().toString(36).slice(2)}`;

  // Sign up. Success redirects (to /account, or / after #134); either way the
  // header then shows the username and Log out.
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).not.toHaveURL(/\/register$/);
  await expectLoggedInAs(page, username);

  // Start practice from the start screen, logged in.
  const actions = await watchServerActions(page);
  await page.goto("/");
  await expectLoggedInAs(page, username);
  // A new account has no daily streak yet (#63): the home screen says so, with a way to the daily.
  const streak = page.getByRole("region", { name: "Daily streak" });
  await expect(streak).toHaveText("No daily streak yet. Play today's daily to start one.");
  await expect(streak.getByRole("link", { name: "Play today's daily" })).toHaveAttribute("href", "/daily");
  await page.getByRole("link", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/play\?game=[0-9a-f-]{36}$/);
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(score(page)).toHaveText("Score 0");

  // Image 1: a wrong guess, one zoom-out, then the right answer.
  const first = puzzleAt(0);
  await guess(page, "definitely not the answer");
  await expect(status(page)).toContainText("isn't it (1 wrong guess)");
  await page.getByRole("button", { name: "Zoom out" }).click();
  // Wait for the new level before the next move: input during a pending move is dropped.
  await expect(page.getByText(/^Zoom level 2 of /)).toBeVisible();
  const firstPoints = pointsIfCorrect(1, 1);
  await expect(page.getByText(`Worth ${firstPoints} points now`)).toBeVisible();
  await actions.expectNoAnswer(first); // start, wrong guess, zoom out
  await guess(page, first.answer);
  await expect(status(page)).toContainText(`Correct! It's ${first.answer}.`);
  await expect(score(page)).toHaveText(`Score ${firstPoints}`);
  actions.skip(); // the correct guess's response shows the answer, as it should
  await page.getByRole("button", { name: "Next image" }).click();

  // Image 2: skip it.
  const second = puzzleAt(1);
  await expect(page.getByText(`Image 2 of ${count}`)).toBeVisible();
  await actions.expectNoAnswer(second);
  await page.getByRole("button", { name: "Skip this image" }).click();
  await expect(status(page)).toHaveText(`Skipped. It was ${second.answer}.`);
  await expect(score(page)).toHaveText(`Score ${firstPoints}`);
  actions.skip();
  await page.getByRole("button", { name: count === 2 ? "See results" : "Next image" }).click();

  // The rest: guess right away.
  let total = firstPoints;
  for (let i = 2; i < count; i++) {
    const p = puzzleAt(i);
    await expect(page.getByText(`Image ${i + 1} of ${count}`)).toBeVisible();
    await actions.expectNoAnswer(p);
    await guess(page, p.answer);
    await expect(status(page)).toContainText(`Correct! It's ${p.answer}.`);
    total += pointsIfCorrect(0, 0);
    await expect(score(page)).toHaveText(`Score ${total}`);
    actions.skip();
    await page.getByRole("button", { name: i === count - 1 ? "See results" : "Next image" }).click();
  }

  // Final score.
  await expect(page.getByRole("heading", { name: "Practice complete" })).toBeVisible();
  await expect(page.getByText(/^You scored/)).toHaveText(
    `You scored ${total} out of ${SCORING_CONFIG.basePoints * count}`,
  );
  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(count);
  await expect(rows.nth(0)).toContainText(`1. ${first.answer} ✓ correct`);
  await expect(rows.nth(1)).toContainText(`2. ${second.answer} skipped`);

  // Play again: a new server game from image 1.
  const finishedUrl = page.url();
  actions.skip();
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(score(page)).toHaveText("Score 0");
  await expect(page).not.toHaveURL(finishedUrl);
  await expect(page).toHaveURL(/\/play\?game=[0-9a-f-]{36}$/);
  await actions.expectNoAnswer(first);

  // Make some progress in the new game, then refresh: it resumes, still logged in.
  await guess(page, "still not the answer");
  await expect(status(page)).toContainText("isn't it (1 wrong guess)");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.getByText(/^Zoom level 2 of /)).toBeVisible();
  await actions.expectNoAnswer(first);
  await actions.stop();
  const gameUrl = page.url();
  const response = await page.reload();
  expect(findAnswer((await response?.text()) ?? "", first), "the page HTML contained an answer").toBeUndefined();
  await expectLoggedInAs(page, username);
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(page.getByText(/^Zoom level 2 of /)).toBeVisible();
  await expect(page.getByText("1 wrong guess", { exact: true })).toBeVisible();

  // Log out from the header: it shows Log in, and the game is no longer this browser's.
  await site(page).getByRole("button", { name: "Log out" }).click();
  await expectLoggedOut(page);
  await page.goto(gameUrl);
  await expectLoggedOut(page);
  // (Next.js adds an empty route-announcer alert of its own.)
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't find that game" })).toBeVisible();
  await expect(guessBox(page)).toHaveCount(0);

  // Log back in with the same details: the header shows the username again,
  // and the account's game resumes where it was left.
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await expectLoggedInAs(page, username);

  await page.goto(gameUrl);
  await expectLoggedInAs(page, username);
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(page.getByText(/^Zoom level 2 of /)).toBeVisible();
  await expect(page.getByText("1 wrong guess", { exact: true })).toBeVisible();
  await guess(page, first.answer);
  await expect(status(page)).toContainText(`Correct! It's ${first.answer}.`);
});
