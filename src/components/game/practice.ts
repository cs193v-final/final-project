import { createGame, currentPuzzle, step, type Game } from "@/game/round";
import type { Puzzle, ScoringEvent } from "@/game/types";

/** What the guess panel tells the player about their last action. */
export type Feedback =
  | { kind: "none" }
  | { kind: "empty" } // submitted a blank guess
  /** `guess` is the normalized guess; `wrongGuesses` is the round's count so far. */
  | { kind: "incorrect"; guess: string; wrongGuesses: number }
  /** `answer` is the canonical answer; `matched` is the accepted answer that matched, as written in the puzzle. */
  | { kind: "correct"; answer: string; matched: string }
  | { kind: "skipped"; answer: string }; // the canonical answer, revealed after skipping

export type PracticeState = {
  game: Game;
  feedback: Feedback;
  /** Every scoring event so far, in order. Scoring (#15/#16) will consume these. */
  events: ScoringEvent[];
};

export type PracticeAction =
  | { type: "reveal" }
  | { type: "guess"; guess: string }
  | { type: "skip" }
  | { type: "next" }
  | { type: "restart" };

export function initPractice(puzzles: readonly Puzzle[]): PracticeState {
  return { game: createGame(puzzles), feedback: { kind: "none" }, events: [] };
}

/**
 * React reducer around the round state machine. Rejected actions leave the
 * state unchanged, except a blank guess, which shows a hint.
 */
export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  if (action.type === "restart") return initPractice(state.game.puzzles);

  const result = step(state.game, action);
  if (!result.ok) {
    return result.reason === "empty-guess" ? { ...state, feedback: { kind: "empty" } } : state;
  }

  const events = result.events.length ? [...state.events, ...result.events] : state.events;
  let feedback: Feedback;
  switch (action.type) {
    case "guess":
      feedback =
        result.outcome?.kind === "correct"
          ? { kind: "correct", answer: currentPuzzle(result.game).answer, matched: result.outcome.matched }
          : {
              kind: "incorrect",
              guess: result.outcome?.kind === "incorrect" ? result.outcome.normalizedGuess : action.guess,
              wrongGuesses: result.game.round.wrongGuesses,
            };
      break;
    case "skip":
      feedback = { kind: "skipped", answer: currentPuzzle(result.game).answer };
      break;
    case "next":
      feedback = { kind: "none" };
      break;
    case "reveal":
      // Revealing more doesn't change what the player was last told.
      feedback = state.feedback;
      break;
  }
  return { game: result.game, feedback, events };
}
