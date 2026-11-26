import { expect, test, type Page, type Response } from "@playwright/test";
import { parsePuzzles } from "@/game/puzzles";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import type { Puzzle } from "@/game/types";
// The same data as SAMPLE_PUZZLES (`@/puzzles`). Playwright runs specs as
// native ES modules, which need the JSON import attribute that Next adds for us.
import sample from "@/puzzles/sample.json" with { type: "json" };
import { guess, guessBox, startRound, startRoundButton } from "./helpers";

// The whole practice game in a real browser (#44), with timed rounds (#255):
// start screen → /play → Start round, wrong guess, correct guess → final
// score → Play again. Answers come from the puzzle data. Points depend on real
// time, so they're read from the screen and checked against
// TIMED_SCORING_CONFIG's bounds. (The time-out is played in full-flow.spec.ts.)
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

/** The points the round just over earned, from "+6,212 points for this image". */
async function roundPoints(page: Page): Promise<number> {
  const text = (await page.getByText(/points? for this image$/).textContent()) ?? "";
  return Number(/\+([\d,]+)/.exec(text)![1]!.replaceAll(",", ""));
}

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
  // Ready: what the image starts at, and no photo until Start round (#255).
  await expect(page.getByText(/^Starts at/)).toContainText(`${TIMED_SCORING_CONFIG.maxPoints.toLocaleString("en-US")} points`);
  await expect(page.getByRole("img", { name: /^Mystery image/ })).toHaveCount(0);
  await expect(startRoundButton(page)).toBeFocused();

  // Image 1: start, a wrong guess (it costs nothing), then the right answer.
  const first = puzzleAt(0);
  await startRound(page);
  await expect(page.getByRole("img", { name: /^Mystery image/ })).toBeVisible();
  await expect(page.getByText(/points now/)).toBeVisible();
  await guess(page, "definitely not the answer");
  await expect(status(page)).toContainText("isn't it (1 wrong guess)");
  await actions.expectNoAnswer(first); // start, Start round, wrong guess
  // Case and extra spaces don't matter.
  await guess(page, `  ${first.answer.toUpperCase()} `);
  // Contains, not equals: the status line also shows a ✓ icon before the text (#48).
  await expect(status(page)).toContainText(`Correct! It's ${first.answer}.`);
  const firstPoints = await roundPoints(page);
  expect(firstPoints).toBeGreaterThanOrEqual(TIMED_SCORING_CONFIG.minPoints);
  expect(firstPoints).toBeLessThanOrEqual(TIMED_SCORING_CONFIG.maxPoints);
  await expect(score(page)).toHaveText(`Score ${firstPoints}`);
  // The image credit only appears once the round is over.
  await expect(page.getByText(/^Photo:/)).toBeVisible();
  actions.skip(); // the correct guess's response shows the answer, as it should
  await page.getByRole("button", { name: "Next image" }).click();

  // The remaining images: start and guess right away, using an alternate answer if there is one.
  let total = firstPoints;
  for (let i = 1; i < count; i++) {
    const p = puzzleAt(i);
    await expect(page.getByText(`Image ${i + 1} of ${count}`)).toBeVisible();
    await expect(page.getByText(/^Photo:/)).toBeHidden();
    await startRound(page);
    await actions.expectNoAnswer(p);
    await guess(page, p.acceptedAnswers[0] ?? p.answer);
    // The server sends only the canonical answer, never the alternate that matched.
    await expect(status(page)).toContainText(`Correct! It's ${p.answer}.`);
    await expect(status(page)).not.toContainText("you said");
    total += await roundPoints(page);
    await expect(score(page)).toHaveText(`Score ${total}`);
    actions.skip();
    await page.getByRole("button", { name: i === count - 1 ? "See results" : "Next image" }).click();
  }

  // Final score screen: each image's time and points.
  await expect(page.getByRole("heading", { name: "Practice complete" })).toBeFocused();
  await expect(page.getByText(/^You scored/)).toHaveText(
    `You scored ${total} out of ${TIMED_SCORING_CONFIG.maxPoints * count}`,
  );
  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(count);
  await expect(rows.nth(0)).toContainText(`1. ${first.answer} ✓ correct`);
  await expect(rows.nth(0)).toContainText(/Got it in \d+\.\d s, 1 wrong guess/);

  // Play again starts a new server game from image 1 with no points.
  const finishedUrl = page.url();
  actions.skip(); // the finished game's last response; checked below from the new game on
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(score(page)).toHaveText("Score 0");
  await expect(startRoundButton(page)).toBeVisible();
  await expect(page).not.toHaveURL(finishedUrl);
  await actions.expectNoAnswer(first);
});

test("a refresh resumes the game, and the page HTML has no answer for the round being played", async ({ page }) => {
  const first = puzzleAt(0);
  await page.goto("/play");
  await expect(page).toHaveURL(/\/play\?game=/);
  await startRound(page);
  await guess(page, "definitely not the answer");
  await expect(status(page)).toContainText("isn't it (1 wrong guess)");

  const url = page.url();
  const response = await page.reload();
  expect(page.url()).toBe(url);
  const html = (await response?.text()) ?? "";
  expect(html).toMatch(/Image (<!-- -->)?1(<!-- -->)? of/); // the server rendered the game itself
  expect(findAnswer(html, first), "the page HTML contained an answer").toBeUndefined();

  // The round's clock kept running on the server: still playing, with its wrong guess.
  await expect(page.getByText(`Image 1 of ${count}`)).toBeVisible();
  await expect(guessBox(page)).toBeVisible();
  await expect(page.getByText("1 wrong guess", { exact: true })).toBeVisible();
  await expect(page.getByText(/points now/)).toBeVisible();

  // And play carries on from there.
  await guess(page, first.answer);
  await expect(status(page)).toContainText(`Correct! It's ${first.answer}.`);
});

test("another browser can't open or play someone else's game", async ({ page, browser }) => {
  await page.goto("/play");
  await expect(page).toHaveURL(/\/play\?game=/);
  await expect(startRoundButton(page)).toBeVisible();

  // A second browser context has its own (or no) owner cookie.
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(page.url());
  // (Next.js adds an empty route-announcer alert of its own.)
  await expect(stranger.getByRole("alert").filter({ hasText: "We couldn't find that game" })).toBeVisible();
  await expect(stranger.getByRole("button", { name: "Start round" })).toHaveCount(0);
  await other.close();
});

test("the browser's JavaScript doesn't contain the puzzle answers", async ({ page }) => {
  const scripts: Response[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response);
  });
  await page.goto("/play");
  await startRound(page);
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

/** A cut image (#57): `/img/<32 hex>.webp`. */
const IMAGE_URL = /\/img\/[0-9a-f]{32}\.webp/gu;
const distinctImageUrls = (text: string) => new Set(text.match(IMAGE_URL) ?? []);

test("the browser gets no photo before Start round, then only the full photo (#255, #57)", async ({ page }) => {
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
  await expect(startRoundButton(page)).toBeVisible();
  // Before the start: no image URL in any response or in the page.
  for (const body of responses) expect(distinctImageUrls(body).size, body.slice(0, 200)).toBe(0);
  expect(distinctImageUrls(await page.content()).size).toBe(0);

  await startRound(page);
  const image = page.getByRole("img", { name: /^Mystery image/ });
  await expect(image).toHaveAttribute("src", /^\/img\/[0-9a-f]{32}\.webp$/u);
  const src = await image.getAttribute("src");
  // Only ever that one image, never another level.
  for (const body of responses) expect(distinctImageUrls(body).size, body.slice(0, 200)).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(image).toHaveAttribute("src", src!);
  expect([...distinctImageUrls(await page.content())]).toEqual([src]);

  // The original photo in public/ was never fetched.
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
    await expect(startRoundButton(page)).toBeVisible({ timeout: 10_000 });
    await startRound(page);
    const img = page.getByRole("img", { name: /^Mystery image/ });
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth / el.naturalHeight)).toBeCloseTo(w / h, 2);
    // From the image figure's top, not the viewport's: focusing the guess box can
    // scroll the page by a different amount each time.
    const frame = await page.locator("figure").first().boundingBox();
    const box = await guessBox(page).boundingBox();
    return { guessY: box!.y - frame!.y };
  }

  const wide = await controlsFor(1600, 800);
  const tall = await controlsFor(800, 1600);
  expect(Math.abs(wide.guessY - tall.guessY)).toBeLessThanOrEqual(1);
});
