// The daily leaderboard's index (#206). Applies the committed migrations to an
// in-memory Postgres (PGlite), checks the index they create, and checks with
// EXPLAIN that the two leaderboard queries (#62, src/db/leaderboard.ts from
// #189) can use it.
//
// The queries are copied here as SQL, with literal values in place of the
// parameters. If the leaderboard queries change shape, update them here too.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const INDEX = "games_daily_date_total_idx";
const DAY = "2026-11-20";

let pg: PGlite;
let someUserId: string;

beforeAll(async () => {
  pg = new PGlite();
  await migrate(drizzle({ client: pg, schema }), { migrationsFolder });

  // 300 players, 60 days of daily games each (18,000 rows on the board), plus
  // rows the index must leave out: unfinished games and anonymous games.
  await pg.exec(`
    INSERT INTO packs (id, kind, title, theme) VALUES ('daily-pack', 'daily', 'Daily', 'Theme');
    INSERT INTO users (username_encrypted, username_index, password_hash)
      SELECT 'v1.encrypted', 'user-' || i, 'hash' FROM generate_series(1, 300) AS i;
    INSERT INTO games (pack_id, user_id, state, total, finished_at, daily_date)
      SELECT 'daily-pack', u.id, '{}', (random() * 1000)::int,
             CASE WHEN random() < 0.9 THEN now() END,
             DATE '${DAY}' - d
      FROM users u CROSS JOIN generate_series(0, 59) AS d;
    INSERT INTO games (pack_id, anon_owner_hash, state, total, finished_at, daily_date)
      SELECT 'daily-pack', 'anon-' || i, '{}', (random() * 1000)::int, now(), DATE '${DAY}' - (i % 60)
      FROM generate_series(1, 3000) AS i;
  `);
  // On its own: VACUUM can't run in the multi-statement block above. It sets
  // the visibility map, so the rank count can be an index-only scan.
  await pg.exec("VACUUM ANALYZE games");
  // A player on DAY's board, somewhere in the middle.
  const { rows } = await pg.query<{ id: string }>(
    `SELECT user_id AS id FROM games
     WHERE daily_date = DATE '${DAY}' AND user_id IS NOT NULL AND finished_at IS NOT NULL
     ORDER BY total, id LIMIT 1 OFFSET 100`,
  );
  someUserId = rows[0]!.id;
}, 120_000);

afterAll(async () => {
  await pg.close();
});

/** `getDailyTop` (#189), with its `onBoard` and `beatAiCount` fragments written out. */
const dailyTop = (date: string) => `
  WITH board AS (
    SELECT g.id, g.user_id, g.total, g.finished_at,
           rank() OVER (ORDER BY g.total DESC) AS rank,
           count(*) OVER () AS players
    FROM games g
    WHERE g.daily_date = '${date}'::date
      AND g.user_id IS NOT NULL
      AND g.finished_at IS NOT NULL
  )
  SELECT g.rank, g.total AS score, g.user_id, g.players, u.username_encrypted, (
    SELECT count(*)::int FROM game_rounds r JOIN puzzles pz ON pz.id = r.puzzle_id
    WHERE r.game_id = g.id
      AND r.outcome = 'correct'
      AND pz.ai_solved_level IS NOT NULL
      AND r.reveal_level_reached < pz.ai_solved_level
  ) AS beat_ai
  FROM board g JOIN users u ON u.id = g.user_id
  ORDER BY g.rank, g.finished_at, g.id
  LIMIT 10
`;

/** `getDailyRank` (#189), likewise. */
const dailyRank = (date: string, userId: string) => `
  SELECT g.total AS score, g.user_id, u.username_encrypted, (
    SELECT count(*)::int FROM game_rounds r JOIN puzzles pz ON pz.id = r.puzzle_id
    WHERE r.game_id = g.id
      AND r.outcome = 'correct'
      AND pz.ai_solved_level IS NOT NULL
      AND r.reveal_level_reached < pz.ai_solved_level
  ) AS beat_ai,
         1 + (SELECT count(*) FROM games g
              WHERE g.daily_date = '${date}'::date
                AND g.user_id IS NOT NULL
                AND g.finished_at IS NOT NULL
                AND g.total > me.total)::int AS rank
  FROM games g
  JOIN users u ON u.id = g.user_id
  CROSS JOIN LATERAL (SELECT g.total) AS me(total)
  WHERE g.daily_date = '${date}'::date
    AND g.user_id IS NOT NULL
    AND g.finished_at IS NOT NULL
    AND g.user_id = '${userId}'::uuid
`;

/** The plan as text. The planner picks the index on its own (no `enable_seqscan = off`). */
async function explain(query: string): Promise<string> {
  const { rows } = await pg.query<{ "QUERY PLAN": string }>(`EXPLAIN ${query}`);
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

describe("leaderboard index (#206)", () => {
  it("is created by the migrations, partial, on (daily_date, total DESC)", async () => {
    const { rows } = await pg.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'games' AND indexname = $1",
      [INDEX],
    );
    expect(rows.map((r) => r.indexdef)).toEqual([
      `CREATE INDEX ${INDEX} ON public.games USING btree (daily_date, total DESC) WHERE ((finished_at IS NOT NULL) AND (user_id IS NOT NULL))`,
    ]);
  });

  it("serves the daily top list (getDailyTop)", async () => {
    const plan = await explain(dailyTop(DAY));
    // Every board row is read (for `count(*) OVER ()`), so this is a bitmap
    // scan of the index on the day, not of the whole table.
    expect(plan).toMatch(new RegExp(`Index (Only )?Scan (on|using) ${INDEX}[\\s\\S]*Index Cond: \\(daily_date = '${DAY}'::date\\)`));
    expect(plan).not.toMatch(/Seq Scan on games/);
  });

  it("serves the count of better players in a player's rank (getDailyRank)", async () => {
    const plan = await explain(dailyRank(DAY, someUserId));
    // The count subquery: an index condition on both the day and the score.
    expect(plan).toMatch(new RegExp(`Index Only Scan using ${INDEX} on games[\\s\\S]*Index Cond: \\(\\(daily_date = '${DAY}'::date\\) AND \\(total > `));
    expect(plan).not.toMatch(/Seq Scan on games/);
  });

  it("still gives the same answers as without it", async () => {
    const withIndex = await pg.query(dailyTop(DAY));
    const rank = await pg.query(dailyRank(DAY, someUserId));
    await pg.exec(`SET enable_indexscan = off; SET enable_indexonlyscan = off; SET enable_bitmapscan = off`);
    try {
      expect((await pg.query(dailyTop(DAY))).rows).toEqual(withIndex.rows);
      expect((await pg.query(dailyRank(DAY, someUserId))).rows).toEqual(rank.rows);
    } finally {
      await pg.exec("RESET enable_indexscan; RESET enable_indexonlyscan; RESET enable_bitmapscan");
    }
    expect(withIndex.rows.length).toBeGreaterThan(0);
  });
});
