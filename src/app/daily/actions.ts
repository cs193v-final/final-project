"use server";

// Server Actions for /daily (#58). Public POST endpoints, so the argument is
// untrusted: the browser only says which day its intro showed, and the server
// checks that it's still today. The server decides the pack. Moves and reloads
// go through /play's actions (the same game service, owner checks and puzzle
// source).

import type { DailyStats } from "@/game/daily-result";
import { loadDailyStats, startTodaysDaily, type DailyStartResult } from "@/server/daily";

/** Start the daily for `date` (the day the intro showed), or resume the player's game for it. */
export async function startDailyAction(date: unknown): Promise<DailyStartResult> {
  return startTodaysDaily(date);
}

/**
 * How the player's finished daily of `date` compares with everyone else's who
 * played that day, image by image. `null` until it's finished. Only ever the
 * caller's own game. TODO(#85): rate-limit with the other daily actions.
 */
export async function dailyStatsAction(date: unknown): Promise<DailyStats | null> {
  try {
    return await loadDailyStats(date);
  } catch (error) {
    console.error("Couldn't load the daily stats", error);
    return null;
  }
}
