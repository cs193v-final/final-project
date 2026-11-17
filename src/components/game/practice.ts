// Client-side helpers for the practice game (#54). The game itself runs on the
// server: the browser sends a `GameAction` and renders the `GameView` it gets
// back. Nothing here checks guesses or scores; it only decides what to tell
// the player. Type-only imports from src/game, so no game logic or puzzle data
// ends up in the browser bundle.
import type { GameAction, GameView, Puzzle } from "@/game/types";

/** What the guess panel tells the player about their last action. */
export type Feedback =
  | { kind: "none" }
  | { kind: "empty" } // submitted a blank guess
  /** `guess` is the normalized guess; `wrongGuesses` is the round's count so far. */
  | { kind: "incorrect"; guess: string; wrongGuesses: number }
  /**
   * `answer` is the canonical answer; `matched` is what the server says
   * matched. The server never sends accepted alternates, so since #54
   * `matched` is the canonical answer too.
   */
  | { kind: "correct"; answer: string; matched: string }
  | { kind: "skipped"; answer: string }; // the canonical answer, revealed after skipping

export const NO_FEEDBACK: Feedback = { kind: "none" };

/**
 * The feedback to show after the server answered `action` with `view`.
 * `action` is null when the view was loaded rather than acted on (start,
 * resume after a refresh), so the feedback is rebuilt from the view alone.
 */
export function feedbackFor(action: GameAction | null, view: GameView, previous: Feedback): Feedback {
  const round = view.round;
  if (round === null) return NO_FEEDBACK;
  if (round.state === "correct") {
    const answer = round.answer ?? "";
    const matched = view.lastOutcome?.kind === "correct" ? view.lastOutcome.matched : answer;
    return { kind: "correct", answer, matched };
  }
  if (round.state === "skipped") return { kind: "skipped", answer: round.answer ?? "" };

  // Still playing.
  const wrong: Feedback | null =
    view.lastOutcome?.kind === "incorrect"
      ? { kind: "incorrect", guess: view.lastOutcome.normalizedGuess, wrongGuesses: round.wrongGuesses }
      : null;
  if (action === null) return wrong ?? NO_FEEDBACK;
  switch (action.type) {
    case "guess":
      return wrong ?? previous;
    case "next":
      return NO_FEEDBACK;
    case "reveal": // revealing more doesn't change what the player was last told
    case "skip": // only reached if the server ignored the skip
      return previous;
  }
}

/** Answers seen so far, by 1-based round position. The view only has the current round's. */
export type KnownAnswers = Readonly<Record<number, string>>;

/** Remember the current round's answer once the server has revealed it. */
export function learnAnswer(known: KnownAnswers, view: GameView): KnownAnswers {
  const round = view.round;
  if (round?.answer === undefined || known[round.position] === round.answer) return known;
  return { ...known, [round.position]: round.answer };
}

/**
 * Rows for the final score screen: each finished round's puzzle id and its
 * answer if this tab saw it (after a refresh on the results, it didn't, so
 * the row says "Image n" instead).
 */
export function finalScoreLabels(view: GameView, known: KnownAnswers): Pick<Puzzle, "id" | "answer">[] {
  return view.results.map((r, i) => ({ id: r.puzzleId, answer: known[i + 1] ?? `Image ${i + 1}` }));
}
