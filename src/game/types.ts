// Shared game types. Each one has an owner (see PROJECT_BRIEF.md); change a type
// only through a PR that its owner reviews.
//
// These started as the PROPOSALs in the brief. Types owned by someone else are
// copied here unchanged so the guessing and round logic can compile; their
// owners make the final call.

/** Owner: Joseph. Copied unchanged from the brief's proposal. */
export type Puzzle = {
  id: string;
  imageUrl: string; // file in the app's static assets, or a URL
  answer: string; // canonical answer, shown after the round
  acceptedAnswers: string[]; // alternates, compared after normalization
  reveal: {
    focus: { x: number; y: number }; // crop center, 0–1 fractions of width/height
    zoomLevels: number[]; // e.g. [8, 4, 2, 1]: index 0 = tightest crop, last = full image
  };
  credit: { source: string; license: string; url?: string }; // image source + usage permission
};

/**
 * Owner: Darian. An integer from 0 (tightest crop) to
 * `puzzle.reveal.zoomLevels.length - 1` (full image).
 */
export type RevealLevel = number;

/**
 * Owner: Jacky. The result of checking one guess.
 *
 * Change from the brief's proposal: added `empty`, so a blank or
 * whitespace-only submission can be ignored instead of costing a wrong guess.
 */
export type GuessOutcome =
  | { kind: "correct"; matched: string } // which answer matched, as written in the puzzle
  | { kind: "incorrect"; normalizedGuess: string }
  | { kind: "empty" };

/** Owner: Jacky. playing → correct | skipped → next puzzle. */
export type RoundState = "playing" | "correct" | "skipped";

/** Emitted by Jacky's round logic, consumed by Ethan's scoring. Unchanged from the brief. */
export type ScoringEvent =
  | { type: "reveal"; puzzleId: string; revealLevel: RevealLevel }
  | { type: "wrongGuess"; puzzleId: string }
  | { type: "correct"; puzzleId: string; revealLevel: RevealLevel }
  | { type: "skip"; puzzleId: string };
