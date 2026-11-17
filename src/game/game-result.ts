// What a game Server Action returns to the browser (#54): a `GameView`, or an
// error code. Framework-free so it's unit-testable; src/server/games.ts wraps
// every game call in `runGameCall`.
//
// Error messages and stacks never go to the browser, only these codes.

import type { GameView } from "./types.ts";
import { GameConflictError, GameNotFoundError, InvalidGameActionError } from "./server-game.ts";

export type GameError =
  /** No such game, or not this player's (the two look the same). Like a 404. */
  | "not-found"
  /** The request wasn't a valid game action. Like a 400. */
  | "invalid"
  /**
   * The game changed since the view this action was sent from, so the action
   * was NOT applied: another tab moved it on, a request saved between this
   * one's read and its save, or an earlier response was lost (#107). The
   * browser reloads the game with getGame and tells the player.
   */
  | "conflict"
  /** Anything else (database down, ...). Logged on the server. */
  | "unavailable";

export type GameResult = { ok: true; view: GameView } | { ok: false; error: GameError };

/**
 * Run a game call and turn its errors into a `GameResult`.
 *
 * A conflict is never retried here: re-running `act` would apply the
 * player's action to a newer state they haven't seen (two tabs both pressing
 * Skip would skip a round nobody looked at). The player sees the current game
 * and decides again.
 */
export async function runGameCall(
  call: () => Promise<GameView>,
  log: (error: unknown) => void = (error) => console.error("game call failed:", error),
): Promise<GameResult> {
  try {
    return { ok: true, view: await call() };
  } catch (error) {
    if (error instanceof GameConflictError) return { ok: false, error: "conflict" };
    if (error instanceof GameNotFoundError) return { ok: false, error: "not-found" };
    if (error instanceof InvalidGameActionError) return { ok: false, error: "invalid" };
    log(error);
    return { ok: false, error: "unavailable" };
  }
}
