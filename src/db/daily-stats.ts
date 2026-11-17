// Per-image stats for a finished daily game (#58): on each image, how many
// other players finished today's daily, and how many of them this player beat.
// Owner: Joseph. Aggregates only: never another player's id or name.
//
// No "server-only" import (tests run it); only for server code.

import { sql } from "drizzle-orm";

import type { DailyStats } from "../game/daily-result.ts";
import type { AnyDb } from "./content.ts";

export type { DailyStats, RoundStat } from "../game/daily-result.ts";
export { betterThanPercent } from "../game/daily-result.ts";

/** `db.execute` returns `{ rows }` on every driver we use. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * Stats for `gameId` against every other *finished* game of the same pack.
 * Two queries, both on indexed columns (game_rounds' key, games' pack index).
 */
export async function getDailyStats(db: AnyDb, gameId: string): Promise<DailyStats> {
  const rounds = rowsOf(
    await db.execute(sql`
      WITH me AS (SELECT pack_id FROM games WHERE id = ${gameId}::uuid),
      others AS (
        SELECT g.id FROM games g, me
        WHERE g.pack_id = me.pack_id AND g.finished_at IS NOT NULL AND g.id <> ${gameId}::uuid
      )
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
      SELECT count(o.id)::int AS others,
             (count(o.id) FILTER (WHERE o.total < me.total))::int AS beaten
      FROM games me
      LEFT JOIN games o ON o.pack_id = me.pack_id AND o.finished_at IS NOT NULL AND o.id <> me.id
      WHERE me.id = ${gameId}::uuid
      GROUP BY me.id
    `),
  );
  return { rounds, others: Number(total?.others ?? 0), beatenTotal: Number(total?.beaten ?? 0) };
}
