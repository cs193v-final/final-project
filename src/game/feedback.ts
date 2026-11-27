// Game-feel rules for timed rounds (#283): what counts as a fast guess, how
// long a streak is, how a final score is rated, and the count-up curve. Pure,
// no React or browser APIs, so it's unit-testable. Only decides what the
// screen celebrates; the server (#255) still decides the points.
import type { TimedScoringConfig } from "./types.ts";

export type SpeedTier = "lightning" | "quick";

/** A correct guess within these shares of `revealSeconds` earns a speed badge. */
export const SPEED_TIERS: readonly { tier: SpeedTier; share: number; label: string }[] = [
  { tier: "lightning", share: 0.2, label: "Lightning fast!" },
  { tier: "quick", share: 0.4, label: "Quick eye!" },
];

/** The badge a correct guess at `seconds` earns, or null if it wasn't fast enough. */
export function speedTier(seconds: number, config: TimedScoringConfig): SpeedTier | null {
  for (const { tier, share } of SPEED_TIERS) {
    if (seconds <= config.revealSeconds * share) return tier;
  }
  return null;
}

export function speedLabel(tier: SpeedTier): string {
  return SPEED_TIERS.find((t) => t.tier === tier)!.label;
}

/** How many rounds in a row, counting back from the latest, were guessed. */
export function correctStreak(outcomes: readonly ("correct" | "timedOut")[]): number {
  let streak = 0;
  for (let i = outcomes.length - 1; i >= 0 && outcomes[i] === "correct"; i--) streak++;
  return streak;
}

/** A streak is worth showing from this many in a row. */
export const STREAK_SHOWN_FROM = 2;

/** One line on the final score, by the share of the most possible points. Highest first. */
export const RATINGS: readonly { atLeast: number; label: string }[] = [
  { atLeast: 0.8, label: "Eagle eye!" },
  { atLeast: 0.6, label: "Sharp!" },
  { atLeast: 0.35, label: "Nicely done." },
  { atLeast: Number.MIN_VALUE, label: "You got on the board." },
  { atLeast: 0, label: "Tough set. Try again tomorrow." },
];

export function scoreRating(total: number, max: number): string {
  const share = max > 0 ? total / max : 0;
  return RATINGS.find((r) => share >= r.atLeast)!.label;
}

/**
 * The number a count-up shows `elapsedMs` into `durationMs`, from 0 to
 * `target`: fast at first, then settling on the exact target (ease-out cubic).
 */
export function countUpValue(target: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return target;
  const t = Math.max(0, elapsedMs) / durationMs;
  return Math.round(target * (1 - (1 - t) ** 3));
}
