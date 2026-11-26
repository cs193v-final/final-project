import { TIMED_SCORING_CONFIG } from "./scoring-config.ts";
import type { RoundResult, ScoringConfig, ScoringEvent, TimedScoringConfig } from "./types.ts";

/**
 * Largest value a scoring field may have (#174). Points end up in Postgres
 * `integer` columns (up to 2,147,483,647): `game_rounds.points` and
 * `games.total`, which is a sum over every round. Capping each field far
 * below the column limit keeps the sums in range too: at this cap a game can
 * have 2,147 rounds before `games.total` could overflow.
 */
export const MAX_SCORING_VALUE = 1_000_000;

/**
 * Throws if an old-style (zoom-out) config can't produce sensible scores.
 * Games no longer use this shape (#255 scores by time); per-pack overrides
 * (#64) use the timed fields too, so it's kept only for the How to play text.
 */
export function validateScoringConfig(config: ScoringConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_SCORING_VALUE) {
      throw new Error(
        `ScoringConfig.${key} must be a whole number from 0 to ${MAX_SCORING_VALUE}, got ${value}`,
      );
    }
  }
  if (config.minPoints > config.basePoints) {
    throw new Error("ScoringConfig.minPoints can't be more than basePoints");
  }
  if (config.skipPoints > config.minPoints) {
    // Otherwise skipping would beat a hard-won correct answer.
    throw new Error("ScoringConfig.skipPoints can't be more than minPoints");
  }
}

/**
 * Score one finished timed round (#255) from its ScoringEvents, in the order
 * `step()` emitted them.
 *
 * - Correct: `scoreAt(seconds, config)`, where `seconds` is the server's own
 *   elapsed time, carried by the `correct` event.
 * - Timed out: 0 points, and `seconds` is `limitSeconds`.
 * - Wrong guesses are counted (for stats) but cost nothing.
 *
 * Throws if the events mix puzzles, don't end in `correct` or `timeOut`, or
 * continue after the round ended.
 */
export function scoreRound(
  events: readonly ScoringEvent[],
  config: TimedScoringConfig = TIMED_SCORING_CONFIG,
): RoundResult {
  validateTimedScoringConfig(config);
  const [first] = events;
  if (first === undefined) throw new Error("scoreRound: no events");
  const puzzleId = first.puzzleId;

  let wrongGuesses = 0;
  let end: { outcome: RoundResult["outcome"]; seconds: number } | undefined;

  for (const event of events) {
    if (event.puzzleId !== puzzleId) {
      throw new Error(`scoreRound: events mix puzzles "${puzzleId}" and "${event.puzzleId}"`);
    }
    if (end !== undefined) {
      throw new Error(`scoreRound: "${event.type}" event after the round ended`);
    }
    switch (event.type) {
      case "wrongGuess":
        wrongGuesses += 1;
        break;
      case "correct":
        end = { outcome: "correct", seconds: event.seconds };
        break;
      case "timeOut":
        end = { outcome: "timedOut", seconds: config.limitSeconds };
        break;
    }
  }

  if (end === undefined) throw new Error(`scoreRound: round "${puzzleId}" hasn't ended`);
  const points = end.outcome === "correct" ? scoreAt(end.seconds, config) : 0;
  return { puzzleId, outcome: end.outcome, seconds: end.seconds, wrongGuesses, points };
}

export type GameScore = {
  /** Finished rounds, in play order. */
  rounds: RoundResult[];
  /** Running total: the sum of `rounds[].points`. */
  total: number;
};

/**
 * Score a whole game from every ScoringEvent so far, in order. Safe to call
 * after every action: events from a round that hasn't ended yet are left out
 * of the total. For what the current image is still worth, use `scoreAt`
 * with the round's elapsed time.
 */
export function scoreGame(
  events: readonly ScoringEvent[],
  config: TimedScoringConfig = TIMED_SCORING_CONFIG,
): GameScore {
  validateTimedScoringConfig(config);
  const rounds: RoundResult[] = [];
  let pending: ScoringEvent[] = [];

  for (const event of events) {
    if (pending.length > 0 && pending[0]!.puzzleId !== event.puzzleId) {
      throw new Error(`scoreGame: round "${pending[0]!.puzzleId}" didn't end before "${event.puzzleId}"`);
    }
    pending.push(event);
    if (event.type === "correct" || event.type === "timeOut") {
      rounds.push(scoreRound(pending, config));
      pending = [];
    }
  }

  const total = rounds.reduce((sum, round) => sum + round.points, 0);
  return { rounds, total };
}

// ---------------------------------------------------------------------------
// Timed-reveal scoring (#254, #256). The server (#255) and the round screen
// both call `scoreAt`, so the number a player sees is the number they get.
// ---------------------------------------------------------------------------

/** Longest round a config may set, in seconds. Keeps typos like 3000 out. */
export const MAX_TIMED_LIMIT_SECONDS = 600;

/** Largest `curve` a config may set. Past this the score is ~min after 1 s. */
export const MAX_TIMED_CURVE = 10;

/**
 * Throws if a timed config can't produce sensible scores: points must be
 * whole numbers that fit a Postgres `integer`, with `minPoints` ≤
 * `maxPoints`; `revealSeconds` > 0; `limitSeconds` ≥ `revealSeconds` (and at
 * most `MAX_TIMED_LIMIT_SECONDS`); `curve` > 0 (and at most `MAX_TIMED_CURVE`).
 */
export function validateTimedScoringConfig(config: TimedScoringConfig): void {
  for (const key of ["maxPoints", "minPoints"] as const) {
    const value = config[key];
    if (!Number.isInteger(value) || value < 0 || value > MAX_SCORING_VALUE) {
      throw new Error(
        `TimedScoringConfig.${key} must be a whole number from 0 to ${MAX_SCORING_VALUE}, got ${value}`,
      );
    }
  }
  if (config.minPoints > config.maxPoints) {
    throw new Error("TimedScoringConfig.minPoints can't be more than maxPoints");
  }
  if (!Number.isFinite(config.revealSeconds) || config.revealSeconds <= 0) {
    throw new Error(`TimedScoringConfig.revealSeconds must be more than 0, got ${config.revealSeconds}`);
  }
  if (
    !Number.isFinite(config.limitSeconds) ||
    config.limitSeconds < config.revealSeconds ||
    config.limitSeconds > MAX_TIMED_LIMIT_SECONDS
  ) {
    throw new Error(
      `TimedScoringConfig.limitSeconds must be from revealSeconds (${config.revealSeconds}) to ${MAX_TIMED_LIMIT_SECONDS}, got ${config.limitSeconds}`,
    );
  }
  if (!Number.isFinite(config.curve) || config.curve <= 0 || config.curve > MAX_TIMED_CURVE) {
    throw new Error(`TimedScoringConfig.curve must be more than 0 and at most ${MAX_TIMED_CURVE}, got ${config.curve}`);
  }
}

/**
 * Points a correct guess earns `seconds` after the round started:
 * `minPoints + (maxPoints − minPoints) × (1 − min(t / revealSeconds, 1))^curve`,
 * rounded to a whole number, and 0 once `t ≥ limitSeconds` (time's up).
 *
 * A negative time counts as 0 (a clock a little behind shouldn't throw mid
 * round). Throws on NaN or infinity, and on an invalid config.
 */
export function scoreAt(seconds: number, config: TimedScoringConfig = TIMED_SCORING_CONFIG): number {
  validateTimedScoringConfig(config);
  if (!Number.isFinite(seconds)) throw new Error(`scoreAt: seconds must be a number, got ${seconds}`);
  const t = Math.max(0, seconds);
  if (t >= config.limitSeconds) return 0;
  const remaining = 1 - Math.min(t / config.revealSeconds, 1);
  return Math.round(config.minPoints + (config.maxPoints - config.minPoints) * remaining ** config.curve);
}
