"use server";

// Server Actions for /daily (#58). Public POST endpoints: no arguments are
// taken from the browser for starting, because the server decides the day and
// the pack. Moves and reloads go through /play's actions (the same game service,
// owner checks and puzzle source).

import type { GameResult } from "@/game/game-result";
import { startTodaysDaily } from "@/server/daily";

/** Start today's daily, or resume the player's game for today. */
export async function startDailyAction(): Promise<GameResult> {
  return startTodaysDaily();
}
