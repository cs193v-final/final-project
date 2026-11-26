// Migration 0009 (timed rounds, #255) on a database that already has rows:
// it applies the migrations up to 0008, writes games and rounds the way the
// old code did, then applies 0009 and checks the old values are kept, new
// timed rounds fit, and old unfinished non-daily games are ended. PGlite, no
// network.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

type Journal = { entries: { idx: number; tag: string }[] };

let pg: PGlite;
let before: string; // a copy of drizzle/ that stops at 0008
let ids: { practiceUnfinished: string; practiceFinished: string; dailyUnfinished: string; finishedAt: Date };

beforeAll(async () => {
  before = mkdtempSync(join(tmpdir(), "migrations-0008-"));
  cpSync(migrationsFolder, before, { recursive: true });
  const journal = JSON.parse(readFileSync(join(before, "meta/_journal.json"), "utf8")) as Journal;
  expect(journal.entries.find((e) => e.idx === 9)?.tag).toBe("0009_timed_rounds");
  journal.entries = journal.entries.filter((e) => e.idx < 9);
  writeFileSync(join(before, "meta/_journal.json"), JSON.stringify(journal));

  pg = new PGlite();
  const db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: before });

  // Rows as the old code wrote them.
  await pg.query("INSERT INTO packs (id, kind, title, theme) VALUES ('pk-p', 'practice', 'P', 'Mixed'), ('pk-d', 'daily', 'D', 'Fruit')");
  await pg.query(
    `INSERT INTO puzzles (id, answer, image_url, focus_x, focus_y, zoom_levels, credit_source, credit_license)
     VALUES ('pz-1', 'Apple', 'a.jpg', 0.5, 0.5, '{4,2,1}', 'S', 'L')`,
  );
  const game = async (sql: string) => (await pg.query<{ id: string; finished_at: Date }>(sql)).rows[0]!;
  const practiceUnfinished = await game("INSERT INTO games (pack_id, state) VALUES ('pk-p', '{}') RETURNING id, finished_at");
  const practiceFinished = await game(
    "INSERT INTO games (pack_id, state, total, finished_at) VALUES ('pk-p', '{}', 80, '2026-11-20T10:00:00Z') RETURNING id, finished_at",
  );
  const dailyUnfinished = await game(
    "INSERT INTO games (pack_id, state, daily_date, anon_owner_hash) VALUES ('pk-d', '{}', '2026-11-25', repeat('a', 64)) RETURNING id, finished_at",
  );
  await pg.query(
    `INSERT INTO game_rounds (game_id, position, puzzle_id, outcome, reveal_level_reached, wrong_guesses, points,
                              base_points, reveal_penalty, wrong_guess_penalty)
     VALUES ($1, 1, 'pz-1', 'correct', 1, 1, 70, 100, 20, 10), ($1, 2, 'pz-1', 'skipped', 2, 0, 0, 0, 0, 0)`,
    [practiceFinished.id],
  );
  ids = {
    practiceUnfinished: practiceUnfinished.id,
    practiceFinished: practiceFinished.id,
    dailyUnfinished: dailyUnfinished.id,
    finishedAt: practiceFinished.finished_at,
  };

  // Now the rest, 0009 included.
  await migrate(db, { migrationsFolder });
}, 60_000);

afterAll(async () => {
  await pg.close();
  rmSync(before, { recursive: true, force: true });
});

const rows = async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;

describe("migration 0009 on tables that already have rows (#255)", () => {
  it("keeps old finished rounds as they were, with no time", async () => {
    expect(
      await rows(
        `SELECT position, outcome, seconds, points, reveal_level_reached, base_points, reveal_penalty, wrong_guess_penalty
         FROM game_rounds WHERE game_id = $1 ORDER BY position`,
        [ids.practiceFinished],
      ),
    ).toEqual([
      { position: 1, outcome: "correct", seconds: null, points: 70, reveal_level_reached: 1, base_points: 100, reveal_penalty: 20, wrong_guess_penalty: 10 },
      { position: 2, outcome: "skipped", seconds: null, points: 0, reveal_level_reached: 2, base_points: 0, reveal_penalty: 0, wrong_guess_penalty: 0 },
    ]);
  });

  it("accepts timed rounds: seconds and points, the zoom-out columns NULL, and a timedOut outcome", async () => {
    await pg.query(
      `INSERT INTO game_rounds (game_id, position, puzzle_id, outcome, seconds, wrong_guesses, points)
       VALUES ($1, 1, 'pz-1', 'correct', 6.25, 2, 6436), ($1, 2, 'pz-1', 'timedOut', 30, 0, 0)`,
      [ids.practiceUnfinished],
    );
    expect(await rows("SELECT outcome, seconds FROM game_rounds WHERE game_id = $1 ORDER BY position", [ids.practiceUnfinished])).toEqual([
      { outcome: "correct", seconds: 6.25 },
      { outcome: "timedOut", seconds: 30 },
    ]);
  });

  it("refuses a round that is neither timed nor old, or a negative time", async () => {
    const insert = (columns: string, values: string) =>
      pg.query(
        `INSERT INTO game_rounds (game_id, position, puzzle_id, outcome, wrong_guesses, points, ${columns})
         VALUES ($1, 9, 'pz-1', 'correct', 0, 0, ${values})`,
        [ids.dailyUnfinished],
      );
    await expect(insert("reveal_level_reached", "1")).rejects.toThrow(/game_rounds_timed_or_old/); // old, missing values
    await expect(insert("seconds, base_points", "1, 100")).rejects.toThrow(/game_rounds_timed_or_old/); // both
    await expect(insert("seconds", "-1")).rejects.toThrow(/game_rounds_seconds_min/);
    await expect(
      pg.query(
        `INSERT INTO game_rounds (game_id, position, puzzle_id, outcome, wrong_guesses, points)
         VALUES ($1, 9, 'pz-1', 'correct', 0, 0)`,
        [ids.dailyUnfinished],
      ),
    ).rejects.toThrow(/game_rounds_timed_or_old/); // neither
  });

  it("ends old unfinished practice games, leaves finished ones' time alone, and leaves daily games unfinished", async () => {
    const finishedAt = async (id: string) => (await rows<{ finished_at: Date | null }>("SELECT finished_at FROM games WHERE id = $1", [id]))[0]!.finished_at;
    expect(await finishedAt(ids.practiceUnfinished)).toBeInstanceOf(Date);
    expect(await finishedAt(ids.practiceFinished)).toEqual(ids.finishedAt);
    expect(await finishedAt(ids.dailyUnfinished)).toBeNull();
    expect((await rows<{ total: number }>("SELECT total FROM games WHERE id = $1", [ids.practiceFinished]))[0]!.total).toBe(80);
  });
});
