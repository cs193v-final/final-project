"use server";

// Server Actions for /daily (#58). Public POST endpoints, so the argument is
// untrusted: the browser only says which day its intro showed, and the server
// checks that it's still today. The server decides the pack. Moves and reloads
// go through /play's actions (the same game service, owner checks and puzzle
// source).

import { startTodaysDaily, type DailyStartResult } from "@/server/daily";

/** Start the daily for `date` (the day the intro showed), or resume the player's game for it. */
export async function startDailyAction(date: unknown): Promise<DailyStartResult> {
  return startTodaysDaily(date);
}
