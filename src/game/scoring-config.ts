import type { ScoringConfig, TimedScoringConfig } from "./types.ts";

/**
 * The scoring values the game uses. PLACEHOLDERS for playtesting: the real
 * values are an open decision (#21). Change them here and nowhere else.
 *
 * With 4 zoom levels per image (at most 3 zoom-outs):
 *   correct, no zoom-outs, no misses    = 100
 *   correct after 2 zoom-outs, 1 miss   = 100 - 40 - 10 = 50
 *   correct after lots of misses        = 10 (the floor)
 *   skip                                = 0
 */
export const SCORING_CONFIG: ScoringConfig = {
  basePoints: 100,
  revealPenalty: 20, // per zoom-out step (flat)
  wrongGuessPenalty: 10, // per wrong guess (flat; increasing penalties are an open decision, #21)
  minPoints: 10, // a correct answer always earns at least this
  skipPoints: 0,
};

/**
 * Timed-reveal scoring (#254, #256): 10,000 at the start, draining to 100 when
 * the photo is clear at 12 s; the round ends with 0 at 15 s. Shortened from
 * 25 s / 30 s after playtesting: 30 s felt too long (#21).
 *   score = 100 + 9,900 × (1 − t / 12)²
 *   correct at 0 s    = 10,000
 *   correct at 6 s    = 2,575
 *   correct at 12–15 s = 100
 *   time's up (15 s)  = 0
 */
export const TIMED_SCORING_CONFIG: TimedScoringConfig = {
  maxPoints: 10_000,
  minPoints: 100,
  revealSeconds: 12,
  limitSeconds: 15,
  curve: 2,
};
