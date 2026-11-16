"use server";

// Server Actions for /play (#54). Each one is a public POST endpoint, so every
// argument is treated as untrusted (`actOnGame` validates the action with
// `parseGameAction`, and the owner comes from the cookie, never the client).
// They return only a `GameResult`: a `GameView` or an error code.
//
// Server Actions rather than Route Handlers: they're only called from our own
// UI, Next checks the Origin header against the Host (CSRF), the types are
// shared with the client without a hand-written fetch layer, and Next sends
// one action at a time per tab, so a fast player can't race their own moves.

import type { GameResult } from "@/game/game-result";
import type { GameAction } from "@/game/types";
import { actOnGame, loadGame, startPracticeGame } from "@/server/games";

/** Start a new practice game. Creates the anonymous owner cookie on first play. */
export async function startGameAction(): Promise<GameResult> {
  return startPracticeGame();
}

/** Apply one player action (reveal, guess, skip, next) to the player's game. */
export async function actAction(gameId: string, action: GameAction): Promise<GameResult> {
  return actOnGame(gameId, action);
}

/** The player's game as it is now, e.g. to resync after a conflict. */
export async function getGameAction(gameId: string): Promise<GameResult> {
  return loadGame(gameId);
}
