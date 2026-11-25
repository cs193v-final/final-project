// The decisions made from CLIP's scores (#56), as pure functions so they're
// tested without the model. Owner: Darian.
//
// - Recognizable: at full view, CLIP's top guess is the answer.
// - Rejects: visible text or watermarks, and people. Only a first filter; the
//   person approving each photo (#180) is the real check.
// - Starting points: of a grid of focus points, the top 3 where CLIP fails at
//   the first (tightest) view but gets it by the middle one.
// - Beat the AI: the first view where CLIP's top guess is the answer is
//   `aiSolvedLevel`, or `null` if it never is.
//
// "CLIP's guess is the answer" (isAnswer) compares the label with the answer
// and its alternates the way the game normalizes guesses (case, punctuation),
// but without the player's typo tolerance: CLIP's labels are never misspelled,
// so tolerance would only count a different word one letter off, like "towel"
// for "Tower" or "house" for "Horse" (#192 review). A regular plural ("peanuts"
// for "Peanut") still counts, as it would for a player.

import { checkGuess, type AnswerMatcher } from "../../game/guess.ts";
import type { Puzzle, RevealLevel } from "../../game/types.ts";

export type Guess = { label: string; probability: number };
/** Every label with its probability, most likely first. */
export type Ranking = readonly Guess[];

/** The puzzle fields that say what counts as right. */
export type Answer = Pick<Puzzle, "answer" | "acceptedAnswers">;

/** CLIP multiplies its similarities by this before the softmax (its learned temperature, 100 in the released weights). */
export const LOGIT_SCALE = 100;

/** Dot product of two vectors of the same length. For unit vectors, their cosine similarity. */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new RangeError(`dot: lengths differ (${a.length} and ${b.length})`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** The labels ranked by probability (softmax of the scaled similarities), most likely first; ties keep label order. */
export function rank(labels: readonly string[], similarities: readonly number[], scale = LOGIT_SCALE): Guess[] {
  if (labels.length === 0 || labels.length !== similarities.length) {
    throw new RangeError(`rank: need one similarity per label, got ${similarities.length} for ${labels.length} labels`);
  }
  const logits = similarities.map((s) => s * scale);
  const max = Math.max(...logits);
  const weights = logits.map((l) => Math.exp(l - max));
  const total = weights.reduce((a, b) => a + b, 0);
  return labels
    .map((label, i) => ({ label, probability: weights[i]! / total, i }))
    .sort((a, b) => b.probability - a.probability || a.i - b.i)
    .map(({ label, probability }) => ({ label, probability }));
}

/**
 * True if normalized `plural` is a regular English plural of normalized
 * `singular`: +s, +es, y → ies, f or fe → ves. The ending is the last word's,
 * so "green beans" is the plural of "green bean".
 */
function isPluralOf(plural: string, singular: string): boolean {
  if (singular === "") return false;
  return (
    plural === `${singular}s` ||
    plural === `${singular}es` ||
    (singular.endsWith("y") && plural === `${singular.slice(0, -1)}ies`) ||
    (singular.endsWith("f") && plural === `${singular.slice(0, -1)}ves`) ||
    (singular.endsWith("fe") && plural === `${singular.slice(0, -2)}ves`)
  );
}

/** The same words, or one is the other's plural: never one letter off. */
const sameOrPlural: AnswerMatcher = (label, answer) => label === answer || isPluralOf(label, answer) || isPluralOf(answer, label);

/** True if `label` is the answer or an alternate, up to case, punctuation and a plural; a near spelling doesn't count. */
export function isAnswer(answer: Answer, label: string): boolean {
  return checkGuess(answer, label, { matcher: sameOrPlural }).kind === "correct";
}

/** CLIP's top guess. */
export function topGuess(ranking: Ranking): Guess {
  const top = ranking[0];
  if (top === undefined) throw new RangeError("topGuess: empty ranking");
  return top;
}

/** True if CLIP's top guess is the answer. */
export function solves(answer: Answer, ranking: Ranking): boolean {
  return isAnswer(answer, topGuess(ranking).label);
}

/** How likely CLIP thinks the answer is: the sum over every label that counts as the answer. */
export function answerProbability(answer: Answer, ranking: Ranking): number {
  return ranking.reduce((sum, guess) => (isAnswer(answer, guess.label) ? sum + guess.probability : sum), 0);
}

/** The first view (0 = tightest) whose top guess is the answer, or `null` if none is: Beat the AI's `aiSolvedLevel`. */
export function firstSolvedLevel(answer: Answer, levels: readonly Ranking[]): RevealLevel | null {
  const level = levels.findIndex((ranking) => solves(answer, ranking));
  return level === -1 ? null : level;
}

/** At full view, the answer is CLIP's top guess. Otherwise the photo is rejected. */
export function isRecognizable(answer: Answer, fullView: Ranking): boolean {
  return solves(answer, fullView);
}

export type RejectKind = "text" | "people";
export const REJECT_KINDS: readonly RejectKind[] = ["text", "people"];

/** A photo is flagged for a reason when CLIP gives it at least this probability. */
export const REJECT_THRESHOLD = 0.5;

/**
 * How likely CLIP thinks a reason to reject applies, from a ranking over that
 * reason's "yes" and "no" sentences: the total probability of the "yes" ones.
 */
export function rejectProbability(ranking: Ranking, yes: readonly string[]): number {
  return ranking.reduce((sum, guess) => (yes.includes(guess.label) ? sum + guess.probability : sum), 0);
}

/** The reasons to reject a photo: each one CLIP gives at least `threshold`. */
export function rejectReasons(probabilities: Readonly<Record<RejectKind, number>>, threshold = REJECT_THRESHOLD): RejectKind[] {
  return REJECT_KINDS.filter((kind) => probabilities[kind] >= threshold);
}

export type Focus = Puzzle["reveal"]["focus"];

/** The centres of a `steps` × `steps` grid over the photo, row by row: 5 steps gives 0.1, 0.3, 0.5, 0.7 and 0.9. */
export function focusGrid(steps = 5): Focus[] {
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError(`focusGrid: steps must be a whole number of at least 1, got ${steps}`);
  const at = (i: number) => Math.round(((i + 0.5) / steps) * 1e6) / 1e6;
  return Array.from({ length: steps * steps }, (_, i) => ({ x: at(i % steps), y: at(Math.floor(i / steps)) }));
}

/** The middle view of `levelCount`, rounding towards the tighter one: 2 of 0–4, 1 of 0–3. */
export function middleLevel(levelCount: number): RevealLevel {
  return Math.max(0, Math.floor((levelCount - 1) / 2));
}

/** What a starting point needs: where it is, the view CLIP solves it at, and how sure CLIP is of the answer at the first view. */
export type FocusResult = { focus: Focus; solvedLevel: RevealLevel | null; openingAnswerProbability: number };

export type SuggestOptions = {
  /** How many to suggest. Default 3. */
  count?: number;
  /** Suggestions at least this far apart (fractions of the photo), so they aren't three neighbours. Default 0.25. */
  minDistance?: number;
};

/**
 * The starting points to suggest: CLIP fails at the first view but solves it
 * at a later view up to the middle one. The most ambiguous first view comes
 * first (lowest probability of the answer, as the #112 user test asked for).
 * Fewer than `count` when fewer qualify; the person picking (#180) can always
 * nudge one by hand.
 */
export function suggestStartingPoints<T extends FocusResult>(
  results: readonly T[],
  levelCount: number,
  { count = 3, minDistance = 0.25 }: SuggestOptions = {},
): T[] {
  const middle = middleLevel(levelCount);
  const qualifying = results
    .map((result, i) => ({ result, i }))
    .filter(({ result: { solvedLevel } }) => solvedLevel !== null && solvedLevel >= 1 && solvedLevel <= middle)
    .sort((a, b) => a.result.openingAnswerProbability - b.result.openingAnswerProbability || a.i - b.i)
    .map(({ result }) => result);
  const picked: T[] = [];
  for (const result of qualifying) {
    if (picked.length === count) break;
    const far = picked.every((p) => Math.hypot(p.focus.x - result.focus.x, p.focus.y - result.focus.y) >= minDistance);
    if (far) picked.push(result);
  }
  return picked;
}
