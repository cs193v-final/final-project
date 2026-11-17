import { expect, test } from "@playwright/test";
import pg from "pg";

import { dailyDateFor } from "@/game/daily-date";

// The daily challenge end to end (#58), on a real database: the intro, a whole
// game, and "one game per player per day" across a reload. Needs a migrated
// and seeded database (CI runs `db:migrate` and `db:seed` first), because it
// schedules today's daily with the practice puzzles. Those are the only
// puzzles in the public repo, so no private content is involved.
//
// Today already has real content scheduled (say, a dev database with the
// Fruit day)? Then the test is skipped rather than replacing it.

import practicePack from "@/puzzles/practice-pack.json" with { type: "json" };
import sample from "@/puzzles/sample.json" with { type: "json" };

const THEME = "Practice mix (e2e)";
const puzzleIds: string[] = practicePack.packs[0]!.puzzleIds;

let scheduledHere = false;

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  test.skip(!url, "needs DATABASE_URL (a migrated and seeded database)");
  const date = dailyDateFor(new Date());
  const packId = `pk-e2e-daily-${date}`;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query<{ pack_id: string }>("SELECT pack_id FROM daily_schedule WHERE date = $1", [date]);
    if (existing.rows[0] && existing.rows[0].pack_id !== packId) return; // real content: leave it
    await client.query(
      "INSERT INTO packs (id, kind, title, theme) VALUES ($1, 'daily', $2, $2) ON CONFLICT (id) DO NOTHING",
      [packId, THEME],
    );
    for (const [i, puzzleId] of puzzleIds.entries()) {
      await client.query(
        "INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [packId, puzzleId, i + 1],
      );
    }
    await client.query("INSERT INTO daily_schedule (date, pack_id) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING", [
      date,
      packId,
    ]);
    scheduledHere = true;
  } finally {
    await client.end();
  }
});

// Cleanup runs once after every project: e2e/global-teardown.ts.

test.beforeEach(() => {
  test.skip(!scheduledHere, "today already has real daily content");
});

test("plays today's daily from the home screen to the result, once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Play today's" }).click();
  await expect(page).toHaveURL(/\/daily$/u);

  // The intro: today's theme and the number of images, before anything starts.
  await expect(page.getByRole("heading", { name: `Today: ${THEME}` })).toBeVisible();
  await expect(page.getByText(`${puzzleIds.length} images, the same for everyone.`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Start today's challenge" }).click();

  // Play it through by skipping each image.
  for (let i = 1; i <= puzzleIds.length; i++) {
    await expect(page.getByText(`Image ${i} of ${puzzleIds.length}`)).toBeVisible();
    await page.getByRole("button", { name: "Skip this image" }).click();
    const next = i === puzzleIds.length ? "See results" : "Next image";
    await page.getByRole("button", { name: next }).click();
  }

  // The result, with no way to play today's again.
  await expect(page.getByText("That's today's challenge.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play again" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/daily$/u);

  // The result panel: countdown, Share, Home, and per-image stats.
  await expect(page.getByText("The next one starts in", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
  const stats = page.getByRole("region", { name: "How you did on each image" });
  // Another run of this test (the other browser project) may have finished first.
  await expect(stats.getByText(/You're the first to finish today|Overall you did better than \d+% of the \d+ other/u)).toBeVisible();

  // Share copies a spoiler-free text: squares and a score, no answers.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined })); // use the clipboard path
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied to the clipboard" })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared).toMatch(new RegExp(`daily · \\w+ \\d+ · ${THEME.replace(/[()]/gu, "\\$&")}\\n[⬛🟩🟨🟧🟥]{${puzzleIds.length}} 0/\\d+`, "u"));
  for (const puzzle of sample) expect(shared.toLowerCase()).not.toContain(puzzle.answer.toLowerCase());

  // Coming back the same day shows the same result, not the intro or a new game.
  await page.reload();
  await expect(page.getByText("That's today's challenge.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start today's challenge" })).toHaveCount(0);
});

test("a game in progress picks up where it was after a reload", async ({ page }) => {
  await page.goto("/daily");
  await page.getByRole("button", { name: "Start today's challenge" }).click();
  await expect(page.getByText(`Image 1 of ${puzzleIds.length}`)).toBeVisible();
  await page.getByRole("button", { name: "Skip this image" }).click();
  await page.getByRole("button", { name: "Next image" }).click();
  await expect(page.getByText(`Image 2 of ${puzzleIds.length}`)).toBeVisible();

  await page.reload();
  await expect(page.getByText(`Image 2 of ${puzzleIds.length}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start today's challenge" })).toHaveCount(0);
});
