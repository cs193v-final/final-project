import { expect, test } from "@playwright/test";
import pg from "pg";

// Stanford mode end to end (#65), on a real database: pick it on the home
// screen, play the pack through, see each image's credit, and finish. Needs a
// migrated and seeded database (CI runs `db:migrate` and `db:seed` first).
//
// The real Stanford pack is private and never in the repo, so this loads an
// obviously fake one made of the practice puzzles, the only puzzles in the
// public repo. A database that already has a real Stanford pack (say, the dev
// database once #181 is seeded) is left alone and the test is skipped.
// Cleanup runs once after every project: e2e/global-teardown.ts.

import practicePack from "@/puzzles/practice-pack.json" with { type: "json" };

const E2E_STANFORD_PACK = "pk-e2e-stanford";
const THEME = "Practice photos standing in for Stanford (e2e)";
const puzzleIds: string[] = practicePack.packs[0]!.puzzleIds;

let loadedHere = false;

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  test.skip(!url, "needs DATABASE_URL (a migrated and seeded database)");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const real = await client.query("SELECT 1 FROM packs WHERE kind = 'stanford' AND id <> $1 LIMIT 1", [E2E_STANFORD_PACK]);
    if (real.rowCount !== 0) return; // real content: leave it
    await client.query(
      "INSERT INTO packs (id, kind, title, theme) VALUES ($1, 'stanford', 'Stanford (e2e)', $2) ON CONFLICT (id) DO NOTHING",
      [E2E_STANFORD_PACK, THEME],
    );
    for (const [i, puzzleId] of puzzleIds.entries()) {
      await client.query(
        "INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [E2E_STANFORD_PACK, puzzleId, i + 1],
      );
    }
    loadedHere = true;
  } finally {
    await client.end();
  }
});

test.beforeEach(() => {
  test.skip(!loadedHere, "the database already has a real Stanford pack");
});

test("plays Stanford mode from the home screen to the final score, with every image credited", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Play Stanford" }).click();
  // 10 s, not the default 5: a cold server compiles or loads the page first.
  await expect(page).toHaveURL(/\/stanford(\?game=[0-9a-f-]+)?$/u, { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stanford");
  // The intro is cached for about a minute, so a server that saw /stanford
  // before this test's pack existed may still say it's coming soon.
  await expect(page.getByText(`${THEME} · ${puzzleIds.length} images`)).toBeVisible({ timeout: 10_000 });

  // A refresh resumes the game: its id is in the URL.
  await expect(page.getByText(`Image 1 of ${puzzleIds.length}`)).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/stanford\?game=[0-9a-f-]+$/u);

  for (let i = 1; i <= puzzleIds.length; i++) {
    await expect(page.getByText(`Image ${i} of ${puzzleIds.length}`)).toBeVisible();
    await expect(page.getByText(/^Photo:/u)).toHaveCount(0); // no credit before the round ends
    await page.getByRole("button", { name: "Skip this image" }).click();
    await expect(page.getByText(/^Photo:/u)).toBeVisible();
    const next = i === puzzleIds.length ? "See results" : "Next image";
    await page.getByRole("button", { name: next }).click();
  }

  await expect(page.getByRole("heading", { name: "Stanford complete" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible();
});
