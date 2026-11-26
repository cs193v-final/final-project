import { checkGuess, type CheckGuessOptions } from "./guess.ts";
import type { GameAction, GuessOutcome, Puzzle, RoundState, ScoringEvent, TimedScoringConfig } from "./types.ts";

// `GameAction` now lives in `types.ts` with the other shared types (#46).
// Re-exported so existing imports from this module keep working.
export type { GameAction };

/**
 * Seconds taken off every round's time (#255), for the network: the clock
 * starts when the server handles `start`, but the player only sees the photo
 * once the response arrives, and a guess takes a moment to reach the server.
 * Without it a fast guess would lose points to latency it can't control.
 */
export const START_GRACE_SECONDS = 0.5;

/** The current puzzle's round (timed, #255). */
export type Round = {
  puzzleId: string;
  state: RoundState;
  /**
   * When the round's clock started, in milliseconds since the epoch, on the
   * server's clock; null while `ready`. Only the server sets it (from its own
   * clock, on `start`), and it stays in the encrypted game state.
   */
  startedAt: number | null;
  wrongGuesses: number;
};

/** The whole game: an ordered list of puzzles and where the player is. */
export type Game = {
  readonly puzzles: readonly Puzzle[];
  /** Index into `puzzles` of the current round. */
  index: number;
  round: Round;
  /** True once the player has moved past the last puzzle's round. */
  finished: boolean;
};

/** The clock and the scoring config a round is timed with. `now` is the server's time in ms. */
export type RoundClock = { now: number; scoring: TimedScoringConfig };

export type RejectReason =
  | "game-finished" // any action after the last round
  | "not-started" // guess before `start`
  | "already-started" // `start` while the clock is running
  | "round-over" // start / guess after the round was answered or timed out
  | "time-up" // guess at or after the time limit (see `timeOut`)
  | "round-in-progress" // next before the round is over
  | "empty-guess"; // blank guess; doesn't count as wrong

export type StepResult =
  | {
      ok: true;
      game: Game;
      /** Scoring events for this action, in order. Pass them to the scoring code. */
      events: ScoringEvent[];
      /** Set for guess actions. */
      outcome?: GuessOutcome;
    }
  | {
      ok: false;
      /** The unchanged game, so callers can always render `result.game`. */
      game: Game;
      events: [];
      reason: RejectReason;
    };

function newRound(puzzle: Puzzle): Round {
  return { puzzleId: puzzle.id, state: "ready", startedAt: null, wrongGuesses: 0 };
}

/** Start a game. Throws on data that would make the game unplayable. */
export function createGame(puzzles: readonly Puzzle[]): Game {
  const [first] = puzzles;
  if (first === undefined) throw new Error("createGame: need at least one puzzle");
  const ids = new Set<string>();
  for (const p of puzzles) {
    if (ids.has(p.id)) throw new Error(`createGame: duplicate puzzle id "${p.id}"`);
    ids.add(p.id);
  }
  return { puzzles, index: 0, round: newRound(first), finished: false };
}

/** The puzzle for the current round. */
export function currentPuzzle(game: Game): Puzzle {
  const puzzle = game.puzzles[game.index];
  if (puzzle === undefined) throw new Error("currentPuzzle: index out of range");
  return puzzle;
}

/**
 * The round's time in seconds at `now`: the server's elapsed time since
 * `start`, less `START_GRACE_SECONDS`, never below 0, rounded to the
 * millisecond (so the stored time and the points scored from it agree
 * exactly). null while the round is `ready`.
 */
export function elapsedSeconds(round: Round, now: number): number | null {
  if (round.startedAt === null) return null;
  const seconds = (now - round.startedAt) / 1000 - START_GRACE_SECONDS;
  return Math.max(0, Math.round(seconds * 1000) / 1000);
}

/** Whether a playing round has reached its time limit at `now`. */
export function isOverdue(round: Round, clock: RoundClock): boolean {
  if (round.state !== "playing") return false;
  const seconds = elapsedSeconds(round, clock.now);
  return seconds !== null && seconds >= clock.scoring.limitSeconds;
}

/**
 * End the round with 0 points if its time is up (#255). There are no timers
 * on the server: the next request for the game (any action, or loading it)
 * calls this first. Returns the timed-out game and its `timeOut` event, or
 * null when the round isn't overdue (nothing to do).
 */
export function timeOut(game: Game, clock: RoundClock): { game: Game; events: ScoringEvent[] } | null {
  if (game.finished || !isOverdue(game.round, clock)) return null;
  return {
    game: { ...game, round: { ...game.round, state: "timedOut" } },
    events: [{ type: "timeOut", puzzleId: game.round.puzzleId }],
  };
}

function reject(game: Game, reason: RejectReason): StepResult {
  return { ok: false, game, events: [], reason };
}

/**
 * Apply one player action at `clock.now`. Pure: returns a new Game and never
 * mutates the old one. Invalid actions (like guessing after the round ended)
 * are rejected with a reason instead of throwing, so the UI can just ignore
 * or explain them. A guess at or after the limit is rejected (`time-up`):
 * call `timeOut` first to end such a round.
 */
export function step(game: Game, action: GameAction, clock: RoundClock, options: CheckGuessOptions = {}): StepResult {
  if (game.finished) return reject(game, "game-finished");
  const { round } = game;
  const puzzleId = round.puzzleId;

  switch (action.type) {
    case "next": {
      if (round.state === "ready" || round.state === "playing") return reject(game, "round-in-progress");
      const index = game.index + 1;
      const puzzle = game.puzzles[index];
      if (puzzle === undefined) {
        return { ok: true, game: { ...game, finished: true }, events: [] };
      }
      return { ok: true, game: { ...game, index, round: newRound(puzzle) }, events: [] };
    }
    case "start": {
      if (round.state === "playing") return reject(game, "already-started");
      if (round.state !== "ready") return reject(game, "round-over");
      return { ok: true, game: { ...game, round: { ...round, state: "playing", startedAt: clock.now } }, events: [] };
    }
    case "guess": {
      if (round.state === "ready") return reject(game, "not-started");
      if (round.state !== "playing") return reject(game, "round-over");
      if (isOverdue(round, clock)) return reject(game, "time-up");
      const outcome = checkGuess(currentPuzzle(game), action.guess, options);
      if (outcome.kind === "empty") return reject(game, "empty-guess");
      if (outcome.kind === "correct") {
        const seconds = elapsedSeconds(round, clock.now) ?? 0;
        return {
          ok: true,
          game: { ...game, round: { ...round, state: "correct" } },
          events: [{ type: "correct", puzzleId, seconds }],
          outcome,
        };
      }
      return {
        ok: true,
        game: { ...game, round: { ...round, wrongGuesses: round.wrongGuesses + 1 } },
        events: [{ type: "wrongGuess", puzzleId }],
        outcome,
      };
    }
  }
}
