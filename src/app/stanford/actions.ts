"use server";

// Server Actions for /stanford (#65). Public POST endpoints: the browser sends
// nothing, the server picks the pack and the owner comes from the cookie.
// Moves and reloads go through /play's actions (the same game service, owner
// checks and rate limits).

import type { GameResult } from "@/game/game-result";
import { startStanfordGame } from "@/server/stanford";

/** Start a Stanford game (or resume an untouched one). Rate-limited like practice (#85). */
export async function startStanfordAction(): Promise<GameResult> {
  return startStanfordGame();
}
