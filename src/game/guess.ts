import type { GuessOutcome, Puzzle } from "./types.ts";

/**
 * Apostrophe- and quote-like characters, mapped to a straight `'` before NFKC.
 * This runs first because NFKC turns the acute accent `´` into a space plus a
 * combining accent, which would otherwise split a word in two.
 */
const APOSTROPHES = /[`´‘’‚‛′ʼ]/gu;
const QUOTES = /[“”„‟″]/gu;

/**
 * Invisible format characters (Unicode category Cf), removed outright: zero-width
 * space, soft hyphen, zero-width joiners, word joiner, direction marks. They
 * come in with pasted text, NFKC keeps them, and they would make a guess that
 * looks exactly right fail to match ("Ov\u200Bal" for "Oval").
 */
const INVISIBLE = /\p{Cf}/gu;

/** Punctuation inside words, removed outright: `St. Paul's` -> `st pauls`. */
const STRIPPED_PUNCTUATION = /[.'"]/gu;

/**
 * Punctuation between words, and hyphens and dashes, become spaces:
 * `Notre-Dame` -> `notre dame`, `Paris,France` -> `paris france`.
 */
const SEPARATORS = /[,!?‐‑‒–—―−-]/gu;

/**
 * Normalize text for comparison: invisible characters removed, Unicode NFKC,
 * curly quotes treated like straight ones, `. ' "` removed, hyphens, dashes
 * and `, ! ?` turned into spaces, then trim, collapse inner whitespace to one
 * space, lowercase.
 *
 * NFKC makes visually identical input compare equal (full-width letters,
 * non-breaking spaces, precomposed vs. combining accents). Accents themselves
 * are kept, so "café" and "cafe" differ here (and under `exactMatch`); the
 * default matcher, `typoTolerantMatch`, ignores accents when it compares.
 *
 * Apostrophes are removed rather than turned into spaces, so "St. Paul's"
 * becomes "st pauls" and matches a guess typed without them. Input that is only
 * punctuation normalizes to "", which checkGuess treats as an empty guess.
 */
export function normalizeGuess(text: string): string {
  return text
    .replace(INVISIBLE, "")
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
 * `checkGuess` calls it for every answer, exact matches included, so a
 * stricter matcher can reject any of them.
 */
export type AnswerMatcher = (normalizedGuess: string, normalizedAnswer: string) => boolean;

export const exactMatch: AnswerMatcher = (guess, answer) => guess === answer;

/**
 * How many typos one word allows, by its length: none for short words, where
 * one letter makes another word ("oval" / "opal"), 1 from 5 letters, 2 from 9.
 * `typoTolerantMatch` applies it to each word on its own, never to a whole
 * answer.
 */
export function allowedTypos(word: string): number {
  const length = [...word].length;
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

/**
 * Latin letters that don't decompose into a base letter plus an accent, so
 * NFD can't strip them: "øresund" -> "oresund", "łódź" -> "lodz". Lowercase
 * only, since `normalizeGuess` lowercases first.
 */
const UNDECOMPOSABLE: Record<string, string> = {
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  ħ: "h",
  ı: "i",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  þ: "th",
};
const UNDECOMPOSABLE_RE = new RegExp(`[${Object.keys(UNDECOMPOSABLE).join("")}]`, "gu");

/** Remove accents: "élysée" -> "elysee", "øresund" -> "oresund". */
const stripAccents = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .replace(UNDECOMPOSABLE_RE, (letter) => UNDECOMPOSABLE[letter]!);

type PreparedWord = { text: string; letters: string[]; digits: string };
type Prepared = { words: PreparedWord[]; joined: string };

function prepare(normalized: string): Prepared {
  const folded = stripAccents(normalized);
  const words = folded.split(" ").map((text) => ({ text, letters: [...text], digits: text.replace(/\D/gu, "") }));
  return { words, joined: folded.replace(/ /gu, "") };
}

/**
 * Whether a guessed word starts like the answer's word: the same first letter,
 * or the first two letters swapped ("aPris" for "Paris"), which is one typo
 * like any other neighbouring swap and is counted by `typoDistance`.
 */
function sameStart(g: PreparedWord, a: PreparedWord): boolean {
  const [g0, g1] = g.letters;
  const [a0, a1] = a.letters;
  return g0 === a0 || (g0 === a1 && g1 === a0);
}

/**
 * The number of typos between a normalized guess and answer under the #21 rule,
 * or `undefined` if the guess isn't accepted. Accents are ignored throughout
 * ("elysee" for "élysée" costs nothing). Word by word, so a long generic word
 * ("The", "Stanford") never buys a typo for a short, distinctive one:
 * - guess and answer must have the same number of words;
 * - each word gets its own `allowedTypos`, by its own length;
 * - each word's first letter must match ("Mesa" isn't "Pesa", "Lake Magunita"
 *   isn't "Lake Lagunita"), unless it's swapped with the second ("aPris");
 * - each word's digits must match exactly ("Building 10" isn't "Building 11").
 * A missing, extra or moved space alone is forgiven ("NotreDame" for "Notre
 * Dame", "Hoove rtower" for "Hoover Tower"), but then the letters must be
 * exactly the same: "StanfordMall" isn't "Stanford Hall".
 */
export function typoCount(normalizedGuess: string, normalizedAnswer: string): number | undefined {
  const guess = prepare(normalizedGuess);
  const answer = prepare(normalizedAnswer);
  if (guess.joined === answer.joined) return 0; // same letters; only spaces (or accents) differ
  if (guess.words.length !== answer.words.length) return undefined;
  let total = 0;
  for (const [i, a] of answer.words.entries()) {
    const g = guess.words[i]!;
    if (!sameStart(g, a) || g.digits !== a.digits) return undefined;
    const max = allowedTypos(a.text);
    const distance = typoDistance(g.text, a.text, max);
    if (distance > max) return undefined;
    total += distance;
  }
  return total;
}

/**
 * Accepts a guess with a few typos (#21: decided by Ethan after the #115 user
 * test, where a player who knew the answer lost points to a typo). See
 * `typoCount` for the rule. Checked on the server like every guess; the answer
 * never reaches the browser.
 */
export const typoTolerantMatch: AnswerMatcher = (guess, answer) => typoCount(guess, answer) !== undefined;

export type CheckGuessOptions = {
  matcher?: AnswerMatcher;
};

/**
 * Check a guess against the puzzle's canonical answer and its accepted
 * alternates. Every answer goes through the matcher, and among the ones it
 * accepts, the closest wins: an exact match first, then the fewest typos, then
 * the canonical answer before alternates. `matched` is that answer as written
 * in the puzzle, so a player who made a typo sees the right spelling.
 */
export function checkGuess(
  puzzle: Pick<Puzzle, "answer" | "acceptedAnswers">,
  guess: string,
  { matcher = typoTolerantMatch }: CheckGuessOptions = {},
): GuessOutcome {
  const normalizedGuess = normalizeGuess(guess);
  if (normalizedGuess === "") return { kind: "empty" };

  const accepted = [puzzle.answer, ...puzzle.acceptedAnswers]
    .map((candidate) => ({ candidate, normalized: normalizeGuess(candidate) }))
    .filter((c) => c.normalized !== "" && matcher(normalizedGuess, c.normalized));
  const exact = accepted.find((c) => c.normalized === normalizedGuess);
  if (exact) return { kind: "correct", matched: exact.candidate };
  if (accepted.length === 0) return { kind: "incorrect", normalizedGuess };
  if (accepted.length === 1) return { kind: "correct", matched: accepted[0]!.candidate };

  // Rarely more than one: typos under the #21 rule, or plain edit distance
  // for answers only a custom matcher accepted.
  const typos = (answer: string) =>
    typoCount(normalizedGuess, answer) ?? typoDistance(stripAccents(normalizedGuess), stripAccents(answer));
  let best = accepted[0]!;
  let bestTypos = typos(best.normalized);
  for (const c of accepted.slice(1)) {
    const t = typos(c.normalized);
    if (t < bestTypos) [best, bestTypos] = [c, t];
  }
  return { kind: "correct", matched: best.candidate };
}
