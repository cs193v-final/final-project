import { SCORING_CONFIG } from "./scoring-config.ts";
import type { RoundResult, ScoringConfig, ScoringEvent } from "./types.ts";

/**
 * Throws if a config can't produce sensible scores. Call it once when the
 * config changes; `scoreRound` and `scoreGame` also call it, so a bad
 * playtest tweak fails loudly in tests instead of showing odd scores.
 */
export function validateScoringConfig(config: ScoringConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`ScoringConfig.${key} must be a number ≥ 0, got ${value}`);
    }
  }
  if (config.minPoints > config.basePoints) {
    throw new Error("ScoringConfig.minPoints can't be more than basePoints");
  }
}

/**
 * Points a correct answer would earn right now, at this reveal level and
 * wrong-guess count. Used for finished rounds, and by the live score (#16) to
 * show what the current image is still worth.
 */
export function pointsIfCorrect(
  revealLevel: number,
  wrongGuesses: number,
  config: ScoringConfig = SCORING_CONFIG,
): number {
  const raw =
    config.basePoints - revealLevel * config.revealPenalty - wrongGuesses * config.wrongGuessPenalty;
  return Math.max(config.minPoints, raw);
}

/**
 * Score one finished round from its ScoringEvents, in the order `step()`
 * emitted them.
 *
 * - Correct: basePoints minus the reveal and wrong-guess penalties, never
 *   below minPoints. If the floor applies, `points` is higher than
 *   `base - revealPenalty - wrongGuessPenalty`; the UI can show that as
 *   "minimum applied".
 * - Skipped: always skipPoints. Penalties don't apply, so the breakdown is
 *   `{ base: skipPoints, revealPenalty: 0, wrongGuessPenalty: 0 }`.
 *
 * Throws if the events mix puzzles, don't end in `correct` or `skip`, or
 * continue after the round ended.
 */
export function scoreRound(
  events: readonly ScoringEvent[],
  config: ScoringConfig = SCORING_CONFIG,
): RoundResult {
  validateScoringConfig(config);
  const [first] = events;
  if (first === undefined) throw new Error("scoreRound: no events");
  const puzzleId = first.puzzleId;

  let revealLevelReached = 0;
  let wrongGuesses = 0;
  let outcome: RoundResult["outcome"] | undefined;

  for (const event of events) {
    if (event.puzzleId !== puzzleId) {
      throw new Error(`scoreRound: events mix puzzles "${puzzleId}" and "${event.puzzleId}"`);
    }
    if (outcome !== undefined) {
      throw new Error(`scoreRound: "${event.type}" event after the round ended`);
    }
    switch (event.type) {
      case "reveal":
        revealLevelReached = Math.max(revealLevelReached, event.revealLevel);
        break;
      case "wrongGuess":
        wrongGuesses += 1;
        break;
      case "correct":
        revealLevelReached = Math.max(revealLevelReached, event.revealLevel);
        outcome = "correct";
        break;
      case "skip":
        outcome = "skipped";
        break;
    }
  }

  if (outcome === undefined) throw new Error(`scoreRound: round "${puzzleId}" hasn't ended`);

  if (outcome === "skipped") {
    return {
      puzzleId,
      outcome,
      revealLevelReached,
      wrongGuesses,
      points: config.skipPoints,
      breakdown: { base: config.skipPoints, revealPenalty: 0, wrongGuessPenalty: 0 },
    };
  }

  return {
    puzzleId,
    outcome,
    revealLevelReached,
    wrongGuesses,
    points: pointsIfCorrect(revealLevelReached, wrongGuesses, config),
    breakdown: {
      base: config.basePoints,
      revealPenalty: revealLevelReached * config.revealPenalty,
      wrongGuessPenalty: wrongGuesses * config.wrongGuessPenalty,
    },
  };
}

/** The round being played, if the last round hasn't ended yet. */
export type RoundInProgress = {
  puzzleId: string;
  revealLevel: number;
  wrongGuesses: number;
  /** What a correct answer would earn right now. */
  pointsIfCorrect: number;
};

export type GameScore = {
  /** Finished rounds, in play order. */
  rounds: RoundResult[];
  /** Running total: the sum of `rounds[].points`. */
  total: number;
  /** Set while the latest round is still being played. */
  current?: RoundInProgress;
};

/**
 * Score a whole game from every ScoringEvent so far, in order (what
 * `practiceReducer` collects in `state.events`). Safe to call after every
 * action for a live score: an unfinished last round shows up as `current`
 * instead of throwing.
 */
export function scoreGame(
  events: readonly ScoringEvent[],
  config: ScoringConfig = SCORING_CONFIG,
): GameScore {
  validateScoringConfig(config);
  const rounds: RoundResult[] = [];
  let pending: ScoringEvent[] = [];

  for (const event of events) {
    if (pending.length > 0 && pending[0]!.puzzleId !== event.puzzleId) {
      throw new Error(`scoreGame: round "${pending[0]!.puzzleId}" didn't end before "${event.puzzleId}"`);
    }
    pending.push(event);
    if (event.type === "correct" || event.type === "skip") {
      rounds.push(scoreRound(pending, config));
      pending = [];
    }
  }

  const total = rounds.reduce((sum, round) => sum + round.points, 0);
  const [first] = pending;
  if (first === undefined) return { rounds, total };

  let revealLevel = 0;
  let wrongGuesses = 0;
  for (const event of pending) {
    if (event.type === "reveal") revealLevel = Math.max(revealLevel, event.revealLevel);
    if (event.type === "wrongGuess") wrongGuesses += 1;
  }
  return {
    rounds,
    total,
    current: {
      puzzleId: first.puzzleId,
      revealLevel,
      wrongGuesses,
      pointsIfCorrect: pointsIfCorrect(revealLevel, wrongGuesses, config),
    },
  };
}
