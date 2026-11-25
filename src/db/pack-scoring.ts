// Reading and writing a pack's scoring override (#64), given a database
// client. The app goes through `getScoringConfig` in `./scoring.ts` (which is
// server-only and uses `getDb()`); `scripts/pack-scoring.ts` and the tests pass
// their own client. Like `./schema.ts`, this file has no "server-only" import
// so the script can load it, and relative imports keep `.ts` so Node can run
// it directly.
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { parseScoringOverride, resolveScoringConfig, ScoringConfigError } from "../game/scoring-override.ts";
import type { ScoringConfig } from "../game/types.ts";
import { packs } from "./schema.ts";
import type * as schema from "./schema.ts";

/** Any Drizzle Postgres client with our schema: Neon HTTP in the app, PGlite in tests. */
export type PgDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Thrown when no pack has the given id. A missing pack is a bug, not "use the default". */
export class PackNotFoundError extends Error {
  readonly packId: string;
  constructor(packId: string) {
    super(`No pack with id "${packId}"`);
    this.name = "PackNotFoundError";
    this.packId = packId;
  }
}

/** The raw `packs.scoring` value (`null` = no override). Throws `PackNotFoundError`. */
export async function readStoredScoring(db: PgDb, packId: string): Promise<unknown> {
  const [row] = await db.select({ scoring: packs.scoring }).from(packs).where(eq(packs.id, packId));
  if (!row) throw new PackNotFoundError(packId);
  return row.scoring;
}

/**
 * The scoring config for a pack: its override merged over `SCORING_CONFIG`,
 * or `SCORING_CONFIG` if it has none. Throws `PackNotFoundError` for an
 * unknown pack id.
 *
 * A stored override that is malformed or fails `validateScoringConfig` does
 * NOT throw: it is logged with `console.error` (it shows up in the Vercel
 * function logs) and the pack plays with the default. Reason: the only way to
 * store a bad value is hand-written SQL, since `setPackScoring` (and so
 * `npm run db:scoring`) validates before writing; and a player getting an
 * error page for every game in that pack is worse than a round scored with
 * the default values. The log line names the pack and the problem so it can
 * be fixed.
 */
export async function getPackScoringConfig(db: PgDb, packId: string): Promise<ScoringConfig> {
  return scoringFromStored(packId, await readStoredScoring(db, packId));
}

/**
 * The scoring config for pack `packId` from its `packs.scoring` value, already
 * read (e.g. with the rest of the pack's row, as the daily does): the same
 * rules as `getPackScoringConfig`, including the log-and-default for an
 * invalid override, without another query.
 */
export function scoringFromStored(packId: string, stored: unknown): ScoringConfig {
  try {
    return resolveScoringConfig(stored);
  } catch (error) {
    if (!(error instanceof ScoringConfigError)) throw error;
    console.error(
      `[scoring] pack "${packId}" has an invalid scoring override, using the default instead: ${error.message}`,
    );
    return resolveScoringConfig(null); // a fresh copy of the default
  }
}

/**
 * Sets (or with `null`, clears) a pack's scoring override. Validates first and
 * throws `ScoringConfigError` without touching the database if the override is
 * invalid; throws `PackNotFoundError` if no pack has that id.
 *
 * A partial override is merged over the current `SCORING_CONFIG` and the full
 * result is stored, so the pack's values are pinned and don't move when the
 * default in code changes. Returns what was stored.
 */
export async function setPackScoring(
  db: PgDb,
  packId: string,
  override: unknown,
): Promise<ScoringConfig | null> {
  const parsed = parseScoringOverride(override);
  const scoring = parsed === null ? null : resolveScoringConfig(parsed);
  const updated = await db
    .update(packs)
    .set({ scoring })
    .where(eq(packs.id, packId))
    .returning({ id: packs.id });
  if (updated.length === 0) throw new PackNotFoundError(packId);
  return scoring;
}
