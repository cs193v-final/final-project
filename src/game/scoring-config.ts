import type { ScoringConfig } from "./types.ts";

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
