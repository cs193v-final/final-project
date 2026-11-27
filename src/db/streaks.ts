// The days a logged-in player played the daily, for streaks (#63). Owner:
// Jacky. No "server-only" import (tests run it); only for server code.
//
// A played day is the challenge date stored on the game when it started
// (`games.daily_date`, migration 0005), so a daily started at 23:59 and
// finished at 00:01 counts for the day it was, and changing the reset time
// later doesn't move past days. Never from timestamps, and never by joining
// `pack_id` to the schedule (a pack scheduled on two days would count twice).

import { and, asc, eq, isNotNull } from "drizzle-orm";

import type { AnyDb } from "./content.ts";
import { games } from "./schema.ts";

/**
 * Each day `userId` finished a daily, oldest first, as "YYYY-MM-DD". Only
 * games owned by the account count (`user_id`), so anonymous games never do,
 * and a game still being played doesn't count until it's finished. At most
 * one row per day (`games_daily_user_key`), which is also the index this reads.
 */
export async function getPlayedDailyDates(db: AnyDb, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ date: games.dailyDate })
    .from(games)
    .where(and(eq(games.userId, userId), isNotNull(games.dailyDate), isNotNull(games.finishedAt)))
    .orderBy(asc(games.dailyDate));
  return rows.flatMap((r) => (r.date === null ? [] : [r.date]));
}
