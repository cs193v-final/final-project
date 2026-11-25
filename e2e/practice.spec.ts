import { expect, test, type Page, type Response } from "@playwright/test";
import { parsePuzzles } from "@/game/puzzles";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { pointsIfCorrect } from "@/game/scoring";
import type { Puzzle } from "@/game/types";
// The same data as SAMPLE_PUZZLES (`@/puzzles`). Playwright runs specs as
// native ES modules, which need the JSON import attribute that Next adds for us.
import sample from "@/puzzles/sample.json" with { type: "json" };
import { guess, guessBox } from "./helpers";

// The whole practice game in a real browser (#44): start screen → /play →
// wrong guess, zoom out, correct guess, skip → final score → Play again.
// Answers and points come from the puzzle data and SCORING_CONFIG, so tuning
// values or swapping puzzles doesn't need a test change.
//
// Since #54 the game runs on the server (Server Actions + Postgres), so these
// tests need DATABASE_URL pointing at a migrated database (README → Testing).
// They also check that no answer reaches the browser while a round is played.

const puzzles = parsePuzzles(sample);
const count = puzzles.length;

function puzzleAt(i: number) {
  const p = puzzles[i];
  if (!p) throw new Error(`The practice game needs at least ${i + 1} puzzles`);
  return p;
}

// The game's status, not the header's login confirmation (#134).
const status = (page: Page) => page.getByRole("main").getByRole("status");
const score = (page: Page) => page.getByText(/^Score \d+$/);

/**
 * Where `puzzle`'s answer (or an accepted answer) appears in `body`, if
 * anywhere. Case-insensitive. Nothing is masked: since #52 puzzle ids and
 * image names are opaque, so even the full-image path (sent until #57) gives
 * nothing away.
 */
function findAnswer(body: string, puzzle: Puzzle): string | undefined {
  const text = body.toLowerCase();
  return [puzzle.answer, ...puzzle.acceptedAnswers].find((a) => text.includes(a.toLowerCase()));
}

/**
 * Records every Server Action response (POSTs from the page) so a test can
 * check, round by round, that none sent the current puzzle's answer while it
 * was being played.
 */
async function watchServerActions(page: Page) {
  // Server Action responses are streamed, and Chromium doesn't keep every
  // streamed body for `response.text()`. So pass them through a route
  // instead: fetch each one here, keep its body, and hand it to the page.
  let pending: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !(await request.headerValue("next-action"))) return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    pending.push(body);
    await route.fulfill({ response, body });
  });
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
  };
}

test("plays the practice game from the start screen to the final score and again", async ({ page }) => {
  test.skip(count < 3, "the flow below uses three images");
  const actions = await watchServerActions(page);

  // Start screen. /play starts a server game and puts its id in the URL.
  await page.goto("/");
  await page.getByRole("link", { name: "Start practice" }).click();
  await expect(page).toHaveURL(/\/play\?game=[0-9a-f-]{36}$/);
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(score(page)).toHaveText("Score 0");
  await expect(page.getByText(`Worth ${SCORING_CONFIG.basePoints} points now`)).toBeVisible();

  // Image 1: a wrong guess, one zoom-out, then the right answer.
  const first = puzzleAt(0);
  await guess(page, "definitely not the answer");
  await expect(status(page)).toContainText("isn't it (1 wrong guess)");
  await page.getByRole("button", { name: "Zoom out" }).click();
  const firstPoints = pointsIfCorrect(1, 1);
  await expect(page.getByText(`Worth ${firstPoints} points now`)).toBeVisible();
  await actions.expectNoAnswer(first); // start, wrong guess, zoom out
  // Case and extra spaces don't matter.
  await guess(page, `  ${first.answer.toUpperCase()} `);
  // Contains, not equals: the status line also shows a ✓ icon before the text (#48).
  await expect(status(page)).toContainText(`Correct! It's ${first.answer}.`);
  await expect(page.getByText(`+${firstPoints} points for this image`)).toBeVisible();
  await expect(score(page)).toHaveText(`Score ${firstPoints}`);
  // The image credit only appears once the round is over.
  await expect(page.getByText(/^Photo:/)).toBeVisible();
  actions.skip(); // the correct guess's response shows the answer, as it should
  await page.getByRole("button", { name: "Next image" }).click();

  // Image 2: skip it.
  const second = puzzleAt(1);
  await expect(page.getByText(`Image 2 of ${count}`)).toBeVisible();
  await expect(page.getByText(/^Photo:/)).toBeHidden();
  await actions.expectNoAnswer(second); // the "next" that started this round
  await page.getByRole("button", { name: "Skip this image" }).click();
  await expect(status(page)).toHaveText(`Skipped. It was ${second.answer}.`);
  await expect(score(page)).toHaveText(`Score ${firstPoints}`);
  actions.skip();
  await page.getByRole("button", { name: count === 2 ? "See results" : "Next image" }).click();

  // The remaining images: guess right away, using an alternate answer if there is one.
  let total = firstPoints;
  for (let i = 2; i < count; i++) {
    const p = puzzleAt(i);
    await expect(page.getByText(`Image ${i + 1} of ${count}`)).toBeVisible();
    await actions.expectNoAnswer(p);
    await guess(page, p.acceptedAnswers[0] ?? p.answer);
    // The server sends only the canonical answer, never the alternate that matched.
    // Contains, not equals, because of the ✓ icon (#48), so check for "you said" separately.
    await expect(status(page)).toContainText(`Correct! It's ${p.answer}.`);
    await expect(status(page)).not.toContainText("you said");
    total += pointsIfCorrect(0, 0);
    await expect(score(page)).toHaveText(`Score ${total}`);
    actions.skip();
    await page.getByRole("button", { name: i === count - 1 ? "See results" : "Next image" }).click();
  }

  // Final score screen.
  await expect(page.getByRole("heading", { name: "Practice complete" })).toBeFocused();
  await expect(page.getByText(/^You scored/)).toHaveText(
    `You scored ${total} out of ${SCORING_CONFIG.basePoints * count}`,
  );
  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(count);
  await expect(rows.nth(0)).toContainText(`1. ${first.answer} ✓ correct`);
  await expect(rows.nth(0)).toContainText("1 zoom-out, 1 wrong guess");
  await expect(rows.nth(1)).toContainText(`2. ${second.answer} skipped`);

  // Play again starts a new server game from image 1 with no points.
  const finishedUrl = page.url();
  actions.skip(); // the finished game's last response; checked below from the new game on
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(score(page)).toHaveText("Score 0");
  await expect(guessBox(page)).toBeVisible();
  await expect(page).not.toHaveURL(finishedUrl);
  await actions.expectNoAnswer(first);
});

test("Zoom out stops at the full image", async ({ page }) => {
  const first = puzzleAt(0);
  const steps = first.reveal.zoomLevels.length - 1;

  await page.goto("/play");
  const zoom = page.getByRole("button", { name: "Zoom out" });
  for (let i = 0; i < steps; i++) {
    await zoom.click();
    // Each click is a round trip to the server; wait for it before the next.
    await expect(page.getByText(`Worth ${pointsIfCorrect(i + 1, 0)} points now`)).toBeVisible();
  }
  await expect(zoom).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText("Showing the full image")).toBeVisible();

  // Pressing it again from the keyboard does nothing, and focus stays on it
  // (why it's aria-disabled rather than disabled).
  await zoom.press("Enter");
  await expect(zoom).toBeFocused();
  await expect(page.getByText(`Worth ${pointsIfCorrect(steps, 0)} points now`)).toBeVisible();
});

test("a refresh resumes the game, and the page HTML has no answer for the round being played", async ({ page }) => {
  const first = puzzleAt(0);
  await page.goto("/play");
  await expect(page).toHaveURL(/\/play\?game=/);
  await guess(page, "definitely not the answer");
  await expect(status(page)).toContainText("isn't it (1 wrong guess)");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.getByText("Zoom level 2 of")).toBeVisible();

  const url = page.url();
  const response = await page.reload();
  expect(page.url()).toBe(url);
  const html = (await response?.text()) ?? "";
  expect(html).toMatch(/Image (<!-- -->)?1(<!-- -->)? of/); // the server rendered the game itself
  expect(findAnswer(html, first), "the page HTML contained an answer").toBeUndefined();

  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(page.getByText("Zoom level 2 of")).toBeVisible();
  await expect(page.getByText("1 wrong guess", { exact: true })).toBeVisible();
  await expect(page.getByText(`Worth ${pointsIfCorrect(1, 1)} points now`)).toBeVisible();

  // And play carries on from there.
  await guess(page, first.answer);
  await expect(status(page)).toContainText(`Correct! It's ${first.answer}.`);
});

test("another browser can't open or play someone else's game", async ({ page, browser }) => {
  await page.goto("/play");
  await expect(page).toHaveURL(/\/play\?game=/);
  await expect(guessBox(page)).toBeVisible();

  // A second browser context has its own (or no) owner cookie.
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(page.url());
  // (Next.js adds an empty route-announcer alert of its own.)
  await expect(stranger.getByRole("alert").filter({ hasText: "We couldn't find that game" })).toBeVisible();
  await expect(stranger.getByRole("textbox", { name: "What is it?" })).toHaveCount(0);
  await other.close();
});

test("the browser's JavaScript doesn't contain the puzzle answers", async ({ page }) => {
  const scripts: Response[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response);
  });
  await page.goto("/play");
  await expect(guessBox(page)).toBeVisible();
  expect(scripts.length).toBeGreaterThan(0);
  for (const script of scripts) {
    const body = await script.text();
    for (const p of puzzles) {
      expect(findAnswer(body, p), `${script.url()} contains an answer`).toBeUndefined();
    }
  }
});

test("leaving /play while the game is still starting stays on the start screen", async ({ page }) => {
  // Hold the start action's response until the player has left /play, so
  // this doesn't depend on how fast the server is.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let sawStart!: () => void;
  const startSent = new Promise<void>((resolve) => (sawStart = resolve));
  let delivered!: () => void;
  const startDelivered = new Promise<void>((resolve) => (delivered = resolve));
  await page.route("**/play*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !(await request.headerValue("next-action"))) return route.fallback();
    sawStart();
    await held;
    // Fetch the whole response here and hand it over in one piece, so we know
    // when the page has it (the server still creates the game).
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() }).catch(() => {}); // the page may have dropped it
    delivered();
  });

  await page.goto("/play");
  await startSent;
  await expect(page.getByText("Starting a new game…")).toBeVisible();
  // exact: the header's "Zoom Out home" link also contains "home".
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("link", { name: "Start practice" })).toBeVisible();

  release();
  await startDelivered;
  // Give the page a couple of frames to (wrongly) act on the late result.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const url = new URL(page.url());
  expect(url.pathname + url.search).toBe("/");
  await expect(page.getByRole("link", { name: "Start practice" })).toBeVisible();
});

/** A cut level image (#57): `/img/<32 hex>.webp`. */
const LEVEL_URL = /\/img\/[0-9a-f]{32}\.webp/gu;
const distinctLevelUrls = (text: string) => new Set(text.match(LEVEL_URL) ?? []);

test("the browser only ever gets the image of the level reached (#57)", async ({ page }) => {
  // Keep every Server Action response, as watchServerActions does.
  const responses: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !(await request.headerValue("next-action"))) return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    responses.push(body);
    await route.fulfill({ response, body });
  });
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));

  await page.goto("/play");
  // The kept copy of the last level is aria-hidden, so this is always the current one.
  const image = page.getByRole("img", { name: /^Mystery image/ });
  await expect(image).toHaveAttribute("src", /^\/img\/[0-9a-f]{32}\.webp$/u);
  const seen = [await image.getAttribute("src")];

  const levels = puzzleAt(0).reveal.zoomLevels.length;
  for (let level = 1; level < levels; level++) {
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(page.getByText(`Zoom level ${level + 1} of ${levels}`)).toBeVisible();
    await expect(image).not.toHaveAttribute("src", seen.at(-1)!);
    await expect(image).toHaveAttribute("src", /^\/img\/[0-9a-f]{32}\.webp$/u);
    seen.push(await image.getAttribute("src"));
  }
  expect(new Set(seen).size, "each level is its own image").toBe(levels);

  // No response ever carried a level beyond the one reached, or any other one.
  expect(responses.length).toBeGreaterThan(0);
  for (const body of responses) expect(distinctLevelUrls(body).size, body.slice(0, 200)).toBeLessThanOrEqual(1);
  // Nor does the page a refresh loads: only the level reached.
  await page.reload();
  await expect(image).toHaveAttribute("src", seen.at(-1)!);
  expect([...distinctLevelUrls(await page.content())]).toEqual([seen.at(-1)]);

  // The original, full-size photo was never fetched.
  expect(requested.filter((path) => path.startsWith("/puzzles/"))).toEqual([]);
});

test("the controls under the image stay in the same place for a wide and a tall photo (#183)", async ({ page }) => {
  // Serve every image as a plain SVG of the given shape, so the test controls the photo's shape.
  async function controlsFor(w: number, h: number) {
    await page.unroute("**/*");
    await page.route("**/*", (route) =>
      route.request().resourceType() === "image"
        ? route.fulfill({
            contentType: "image/svg+xml",
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#888"/></svg>`,
          })
        : route.fallback(),
    );
    await page.goto("/play");
    await expect(guessBox(page)).toBeVisible({ timeout: 10_000 });
    const img = page.getByRole("img", { name: /^Mystery image/ });
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight)).toBeCloseTo(w / h, 2);
    // From the image figure's top, not the viewport's: focusing the guess box can
    // scroll the page by a different amount each time.
    const frame = await page.locator("figure").first().boundingBox();
    const zoom = await page.getByRole("button", { name: "Zoom out" }).boundingBox();
    const box = await guessBox(page).boundingBox();
    return { zoomY: zoom!.y - frame!.y, guessY: box!.y - frame!.y };
  }

  const wide = await controlsFor(1600, 800);
  const tall = await controlsFor(800, 1600);
  expect(Math.abs(wide.zoomY - tall.zoomY)).toBeLessThanOrEqual(1);
  expect(Math.abs(wide.guessY - tall.guessY)).toBeLessThanOrEqual(1);
});
