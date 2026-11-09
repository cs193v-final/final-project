import { checkGuess, type CheckGuessOptions } from "./guess.ts";
import type { GuessOutcome, Puzzle, RevealLevel, RoundState, ScoringEvent } from "./types.ts";

/** The current puzzle's round. */
export type Round = {
  puzzleId: string;
  state: RoundState;
  revealLevel: RevealLevel;
  /** Highest reveal level for this puzzle (the full image). */
  maxRevealLevel: RevealLevel;
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

export type GameAction =
  | { type: "reveal" }
  | { type: "guess"; guess: string }
  | { type: "skip" }
  | { type: "next" };

export type RejectReason =
  | "game-finished" // any action after the last round
  | "round-over" // reveal / guess / skip after the round was answered or skipped
  | "round-in-progress" // next while still playing
  | "fully-revealed" // reveal at the full image
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
  return {
    puzzleId: puzzle.id,
    state: "playing",
    revealLevel: 0,
    maxRevealLevel: puzzle.reveal.zoomLevels.length - 1,
    wrongGuesses: 0,
  };
}

/** Start a game. Throws on data that would make the game unplayable. */
export function createGame(puzzles: readonly Puzzle[]): Game {
  const [first] = puzzles;
  if (first === undefined) throw new Error("createGame: need at least one puzzle");
  const ids = new Set<string>();
  for (const p of puzzles) {
    if (p.reveal.zoomLevels.length === 0) {
      throw new Error(`createGame: puzzle "${p.id}" has no zoom levels`);
    }
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

function reject(game: Game, reason: RejectReason): StepResult {
  return { ok: false, game, events: [], reason };
}

/**
 * Apply one player action. Pure: returns a new Game and never mutates the old
 * one. Invalid actions (like guessing after the round ended) are rejected
 * with a reason instead of throwing, so the UI can just ignore or explain them.
 */
export function step(game: Game, action: GameAction, options: CheckGuessOptions = {}): StepResult {
  if (game.finished) return reject(game, "game-finished");
  const { round } = game;
  const puzzleId = round.puzzleId;

  if (action.type === "next") {
    if (round.state === "playing") return reject(game, "round-in-progress");
    const index = game.index + 1;
    const puzzle = game.puzzles[index];
    if (puzzle === undefined) {
      return { ok: true, game: { ...game, finished: true }, events: [] };
    }
    return { ok: true, game: { ...game, index, round: newRound(puzzle) }, events: [] };
  }

  if (round.state !== "playing") return reject(game, "round-over");

  switch (action.type) {
    case "reveal": {
      if (round.revealLevel >= round.maxRevealLevel) return reject(game, "fully-revealed");
      const revealLevel = round.revealLevel + 1;
      return {
        ok: true,
        game: { ...game, round: { ...round, revealLevel } },
        events: [{ type: "reveal", puzzleId, revealLevel }],
      };
    }
    case "guess": {
      const outcome = checkGuess(currentPuzzle(game), action.guess, options);
      if (outcome.kind === "empty") return reject(game, "empty-guess");
      if (outcome.kind === "correct") {
        return {
          ok: true,
          game: { ...game, round: { ...round, state: "correct" } },
          events: [{ type: "correct", puzzleId, revealLevel: round.revealLevel }],
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
    case "skip":
      return {
        ok: true,
        game: { ...game, round: { ...round, state: "skipped" } },
        events: [{ type: "skip", puzzleId }],
      };
  }
}
