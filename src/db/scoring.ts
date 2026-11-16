// Per-pack scoring for the app (#64). Server-only, like `./index.ts`.
import "server-only";

import type { ScoringConfig } from "@/game/types";

import { getDb } from "./index";
import { getPackScoringConfig } from "./pack-scoring";

export { PackNotFoundError } from "./pack-scoring";

/**
 * The scoring config to play pack `packId` with: its `packs.scoring` override
 * (merged over the default), or `SCORING_CONFIG` if it has none.
 *
 * - Unknown pack id: throws `PackNotFoundError`.
 * - Invalid stored override: logs with `console.error` and returns the
 *   default (see `getPackScoringConfig` for why).
 *
 * Read it once when a game starts and keep it in the game's state (#54), so a
 * change to the pack's values only affects games started afterwards.
 */
export function getScoringConfig(packId: string): Promise<ScoringConfig> {
  return getPackScoringConfig(getDb(), packId);
}
