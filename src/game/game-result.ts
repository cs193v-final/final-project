// What a game Server Action returns to the browser (#54): a `GameView`, or an
// error code. Framework-free so it's unit-testable; src/server/games.ts wraps
// every game call in `runGameCall`.
//
// Error messages and stacks never go to the browser, only these codes.

import type { GameView } from "./types.ts";
import { GameConflictError, GameNotFoundError, GuessLimitError, InvalidGameActionError } from "./server-game.ts";
import { errorForLog, type LoggedError } from "./log-safe.ts";

export type GameError =
  /** No such game, or not this player's (the two look the same). Like a 404. */
  | "not-found"
  /** The request wasn't a valid game action. Like a 400. */
  | "invalid"
  /**
   * A guess in a round that has reached the wrong-guess safety cap
   * (`MAX_WRONG_GUESSES_PER_ROUND`, #209). Nothing was changed; zoom out and
   * skip still work. Like a 400.
   */
  | "guess-limit"
  /**
   * The game changed since the view this action was sent from, so the action
   * was NOT applied: another tab moved it on, a request saved between this
   * one's read and its save, or an earlier response was lost (#107). The
   * browser reloads the game with getGame and tells the player.
   */
  | "conflict"
  /**
   * Too many games started or moves made in a short time (#85, limits in
   * src/server/limits.ts). Nothing was changed. Like a 429.
   */
  | "rate-limited"
  /** Anything else (database down, ...). Logged on the server. */
  | "unavailable";

export type GameResult = { ok: true; view: GameView } | { ok: false; error: GameError };

/** A rate limit or cap was hit (#85). `runGameCall` turns it into `rate-limited`. */
export class RateLimitedError extends Error {
  constructor(readonly limit: string) {
    super(`rate limited: ${limit}`);
    this.name = "RateLimitedError";
  }
}

/**
 * Run a game call and turn its errors into a `GameResult`.
 *
 * A conflict is never retried here: re-running `act` would apply the
 * player's action to a newer state they haven't seen (two tabs both pressing
 * Skip would skip a round nobody looked at). The player sees the current game
 * and decides again.
 *
 * Anything else is logged, after `errorForLog` removes the values from it
 * (#60), whichever `log` is passed. The default logs it as one JSON line, so
 * deep causes aren't cut to `[Object]` and the line is easy to search.
 */
export async function runGameCall(
  call: () => Promise<GameView>,
  log: (error: LoggedError) => void = (error) => console.error("game call failed:", JSON.stringify(error)),
): Promise<GameResult> {
  try {
    return { ok: true, view: await call() };
  } catch (error) {
    if (error instanceof GameConflictError) return { ok: false, error: "conflict" };
    if (error instanceof GameNotFoundError) return { ok: false, error: "not-found" };
    // Before InvalidGameActionError: it's a subclass with its own message for the player.
    if (error instanceof GuessLimitError) return { ok: false, error: "guess-limit" };
    if (error instanceof InvalidGameActionError) return { ok: false, error: "invalid" };
    if (error instanceof RateLimitedError) return { ok: false, error: "rate-limited" };
    log(errorForLog(error));
    return { ok: false, error: "unavailable" };
  }
}
