import type { GuessOutcome, Puzzle } from "./types.ts";

/**
 * Apostrophe- and quote-like characters, mapped to a straight `'` before NFKC.
 * This runs first because NFKC turns the acute accent `´` into a space plus a
 * combining accent, which would otherwise split a word in two.
 */
const APOSTROPHES = /[`´‘’‚‛′ʼ]/gu;
const QUOTES = /[“”„‟″]/gu;

/** Punctuation inside words, removed outright: `St. Paul's` -> `st pauls`. */
const STRIPPED_PUNCTUATION = /[.'"]/gu;

/**
 * Punctuation between words, and hyphens and dashes, become spaces:
 * `Notre-Dame` -> `notre dame`, `Paris,France` -> `paris france`.
 */
const SEPARATORS = /[,!?‐‑‒–—―−-]/gu;

/**
 * Normalize text for comparison: Unicode NFKC, curly quotes treated like
 * straight ones, `. ' "` removed, hyphens, dashes and `, ! ?` turned into
 * spaces, then trim, collapse inner whitespace to one space, lowercase.
 *
 * NFKC makes visually identical input compare equal (full-width letters,
 * non-breaking spaces, precomposed vs. combining accents). Accents themselves
 * are kept, so "café" and "cafe" differ by one character, which typo
 * tolerance (`typoTolerantMatch`) forgives in answers of 5+ letters.
 *
 * Apostrophes are removed rather than turned into spaces, so "St. Paul's"
 * becomes "st pauls" and matches a guess typed without them. Input that is only
 * punctuation normalizes to "", which checkGuess treats as an empty guess.
 */
export function normalizeGuess(text: string): string {
  return text
    .replace(APOSTROPHES, "'")
    .replace(QUOTES, '"')
    .normalize("NFKC")
    .replace(STRIPPED_PUNCTUATION, "")
    .replace(SEPARATORS, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/**
 * Decides whether a normalized guess matches a normalized answer. The default
 * is `typoTolerantMatch` (#21, #115); pass `exactMatch` for no tolerance.
 */
export type AnswerMatcher = (normalizedGuess: string, normalizedAnswer: string) => boolean;

export const exactMatch: AnswerMatcher = (guess, answer) => guess === answer;

/**
 * How many typos an answer allows, by its length without spaces: none for
 * short answers (where one letter changes the word: "cat" / "car"), 1 from 5
 * letters, 2 from 9.
 */
export function allowedTypos(normalizedAnswer: string): number {
  const length = [...normalizedAnswer.replace(/ /gu, "")].length;
  if (length >= 9) return 2;
  if (length >= 5) return 1;
  return 0;
}

/**
 * Edit distance with adjacent swaps (optimal string alignment): the number of
 * single-character insertions, deletions, substitutions or swaps of two
 * neighbouring characters that turn `a` into `b`. Stops early and returns
 * `max + 1` once the distance is known to exceed `max`.
 */
export function typoDistance(a: string, b: string, max = Infinity): number {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d = Math.min(d, prevPrev[j - 2]! + 1);
      row.push(d);
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[y.length]!;
}

const digits = (text: string) => text.replace(/\D/gu, "");

/**
 * Accepts a guess within `allowedTypos(answer)` typos (#21, decided after the
 * #115 user test, where a player who knew the answer lost points to a typo).
 * Two guards against accepting a different place that happens to be close:
 * - the first character must match ("Mesa" isn't "Pesa"),
 * - digits must match exactly ("Building 10" isn't "Building 11").
 * Checked on the server like every guess; the answer never reaches the browser.
 */
export const typoTolerantMatch: AnswerMatcher = (guess, answer) => {
  if (guess === answer) return true;
  const max = allowedTypos(answer);
  if (max === 0) return false;
  if ([...guess][0] !== [...answer][0]) return false;
  if (digits(guess) !== digits(answer)) return false;
  return typoDistance(guess, answer, max) <= max;
};

export type CheckGuessOptions = {
  matcher?: AnswerMatcher;
};

/**
 * Check a guess against the puzzle's canonical answer and its accepted
 * alternates. `matched` is the answer as written in the puzzle, so the UI can
 * show it (and a player who made a typo sees the right spelling). An exact
 * match on any answer wins over a typo match, and the canonical answer wins
 * among equals.
 */
export function checkGuess(
  puzzle: Pick<Puzzle, "answer" | "acceptedAnswers">,
  guess: string,
  { matcher = typoTolerantMatch }: CheckGuessOptions = {},
): GuessOutcome {
  const normalizedGuess = normalizeGuess(guess);
  if (normalizedGuess === "") return { kind: "empty" };

  const candidates = [puzzle.answer, ...puzzle.acceptedAnswers]
    .map((candidate) => ({ candidate, normalized: normalizeGuess(candidate) }))
    .filter((c) => c.normalized !== "");
  const exact = candidates.find((c) => c.normalized === normalizedGuess);
  if (exact) return { kind: "correct", matched: exact.candidate };
  for (const { candidate, normalized } of candidates) {
    if (matcher(normalizedGuess, normalized)) return { kind: "correct", matched: candidate };
  }
  return { kind: "incorrect", normalizedGuess };
}
