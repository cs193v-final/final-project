// The practice pack's scoring config for the home page's "How to play" (#204).
// Server-only: it reads the database.
import "server-only";

import { cacheLife } from "next/cache";

import { getScoringConfig } from "@/db/scoring";
import { resolveScoringConfig } from "@/game/scoring-override";
import type { ScoringConfig } from "@/game/types";
import { PRACTICE_PACK } from "@/puzzles";

/**
 * The scoring config practice games start with: the practice pack's stored
 * override (#64), or the default. "How to play" on the home page describes
 * practice, so its numbers come from here and match the game.
 *
 * Cached, the same for everyone: with Cache Components it's read while
 * prerendering the home page, so it's part of the static shell, and then
 * refreshed in the background at most about once a minute ("minutes", like
 * the daily intro). The home page adds no database read per request.
 *
 * Never throws. A missing practice pack row (no practice game started yet, so
 * no override either) or a database error gives the default, logged. The
 * default is cached too, for a minute, so a build without a database (CI) or a
 * short outage heals by itself on the next refresh.
 */
export async function loadPracticeScoring(): Promise<ScoringConfig> {
  "use cache";
  cacheLife("minutes");
  try {
    return await getScoringConfig(PRACTICE_PACK.id);
  } catch (error) {
    console.error("[scoring] couldn't read the practice pack's scoring, showing the default", error);
    return resolveScoringConfig(null); // a fresh copy of the default
  }
}
