// Per-image stats for a finished daily game (#58): on each image, how many
// other players finished the same day's daily, and how many of them this
// player beat. Owner: Joseph. Aggregates only: never another player's id.
//
// No "server-only" import (tests run it); only for server code.

import { sql } from "drizzle-orm";

import type { DailyStats } from "../game/daily-result.ts";
import type { AnyDb } from "./content.ts";
import { rowsOf } from "./rows.ts";

export type { DailyStats, RoundStat } from "../game/daily-result.ts";
export { betterThanPercent } from "../game/daily-result.ts";

/**
 * Stats for `gameId` against every other finished game of the **same day's
 * daily**: same pack and same `daily_date` (a pack reused on another day, or
 * in another mode, never counts; review of #121). Both counts come from the
 * same set of players, those whose rounds were recorded, so the overall line
 * and the per-image lines can't disagree. Two queries on indexed columns.
 */
export async function getDailyStats(db: AnyDb, gameId: string): Promise<DailyStats> {
  const others = sql`
    SELECT g.id, g.total FROM games g, games me
    WHERE me.id = ${gameId}::uuid
      AND me.daily_date IS NOT NULL
      AND g.pack_id = me.pack_id
      AND g.daily_date = me.daily_date
      AND g.finished_at IS NOT NULL
      AND g.id <> me.id
      AND EXISTS (SELECT 1 FROM game_rounds r WHERE r.game_id = g.id)
  `;
  const rounds = rowsOf(
    await db.execute(sql`
      WITH others AS (${others})
      SELECT mine.position,
             count(o.game_id)::int AS others,
             (count(o.game_id) FILTER (WHERE o.points < mine.points))::int AS beaten
      FROM game_rounds mine
      LEFT JOIN game_rounds o ON o.position = mine.position AND o.game_id IN (SELECT id FROM others)
      WHERE mine.game_id = ${gameId}::uuid
      GROUP BY mine.position
      ORDER BY mine.position
    `),
  ).map((r) => ({ position: Number(r.position), others: Number(r.others), beaten: Number(r.beaten) }));

  const [total] = rowsOf(
    await db.execute(sql`
      WITH others AS (${others})
      SELECT count(o.id)::int AS others,
             (count(o.id) FILTER (WHERE o.total < me.total))::int AS beaten
      FROM games me LEFT JOIN others o ON true
      WHERE me.id = ${gameId}::uuid
      GROUP BY me.id, me.total
    `),
  );
  return { rounds, others: Number(total?.others ?? 0), beatenTotal: Number(total?.beaten ?? 0) };
}
