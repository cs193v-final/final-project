import type { GuessOutcome, Puzzle } from "./types.ts";

/**
 * Normalize text for comparison: Unicode NFKC, trim, collapse inner
 * whitespace to one space, lowercase.
 *
 * NFKC makes visually identical input compare equal (full-width letters,
 * non-breaking spaces, precomposed vs. combining accents). Accents themselves
 * are kept, so "café" and "cafe" still differ; that's part of the open
 * typo-tolerance decision.
 */
export function normalizeGuess(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Decides whether a normalized guess matches a normalized answer. Exact
 * equality for now. Typo tolerance (edit distance, etc.) is an open decision in
 * PROJECT_BRIEF.md; when it's settled, pass a different matcher here instead of
 * changing checkGuess.
 */
export type AnswerMatcher = (normalizedGuess: string, normalizedAnswer: string) => boolean;

export const exactMatch: AnswerMatcher = (guess, answer) => guess === answer;

export type CheckGuessOptions = {
  matcher?: AnswerMatcher;
};

/**
 * Check a guess against the puzzle's canonical answer and its accepted
 * alternates. `matched` is the answer as written in the puzzle, so the UI can
 * show it. The canonical answer wins if several answers match.
 */
export function checkGuess(
  puzzle: Pick<Puzzle, "answer" | "acceptedAnswers">,
  guess: string,
  { matcher = exactMatch }: CheckGuessOptions = {},
): GuessOutcome {
  const normalizedGuess = normalizeGuess(guess);
  if (normalizedGuess === "") return { kind: "empty" };

  for (const candidate of [puzzle.answer, ...puzzle.acceptedAnswers]) {
    const normalizedCandidate = normalizeGuess(candidate);
    if (normalizedCandidate !== "" && matcher(normalizedGuess, normalizedCandidate)) {
      return { kind: "correct", matched: candidate };
    }
  }
  return { kind: "incorrect", normalizedGuess };
}
