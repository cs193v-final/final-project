// What a game Server Action returns to the browser (#54): a `GameView`, or an
// error code. Framework-free so it's unit-testable; the actions in
// src/app/play/actions.ts wrap every game call in `runGameCall`.
//
// Error messages and stacks never go to the browser, only these codes.

import type { GameView } from "./types.ts";
import { GameConflictError, GameNotFoundError, InvalidGameActionError } from "./server-game.ts";

export type GameError =
  /** No such game, or not this player's (the two look the same). Like a 404. */
  | "not-found"
  /** The request wasn't a valid game action. Like a 400. */
  | "invalid"
  /** Another request kept changing the game (e.g. a second tab). Refresh to continue. */
  | "conflict"
  /** Anything else (database down, ...). Logged on the server. */
  | "unavailable";

export type GameResult = { ok: true; view: GameView } | { ok: false; error: GameError };

/**
 * Run a game call and turn its errors into a `GameResult`. On a
 * `GameConflictError` (another request saved the game first) it runs `call`
 * once more, which re-reads the game, and reports `conflict` if that loses too.
 */
export async function runGameCall(
  call: () => Promise<GameView>,
  log: (error: unknown) => void = (error) => console.error("game call failed:", error),
): Promise<GameResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ok: true, view: await call() };
    } catch (error) {
      if (error instanceof GameConflictError && attempt < 2) continue;
      if (error instanceof GameConflictError) return { ok: false, error: "conflict" };
      if (error instanceof GameNotFoundError) return { ok: false, error: "not-found" };
      if (error instanceof InvalidGameActionError) return { ok: false, error: "invalid" };
      log(error);
      return { ok: false, error: "unavailable" };
    }
  }
}
