// Encrypts the state of games stored before #84 (plain `games.state`).
// The app already reads those and encrypts each one the next time it's saved;
// this finishes the job for games nobody will save again (finished or
// abandoned ones), so no plain state is left. Run once per tier after
// migration 0006, with that tier's DATA_ENCRYPTION_KEY:
//
//   npm run db:encrypt-games
//
// Connects with DATABASE_URL_UNPOOLED, like the other db scripts: a value in
// the environment wins over .env.local. Safe to run again (it only touches
// rows that still have a plain state) and while players are playing: each
// update checks the row's revision and bumps it, so a save racing it gets the
// normal conflict-and-reload path. A game that changed meanwhile is retried
// once at the end; if it's still plain after that, the script says to run it
// again. Prints counts, never game data.
//
// Runs with plain Node (type stripping), so imports are relative with `.ts`.
import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";

import { EncryptionKeyError, Vault } from "../src/crypto/vault.ts";
import type { AnyDb } from "../src/db/content.ts";
import { STATE_FIELD, stateKeyId } from "../src/db/game-state-key.ts";
import { assertDatabaseUrlRequiresTls, InsecureDatabaseUrlError } from "../src/db/tls.ts";
import { connect } from "./seed-db.ts";

type PlainRow = { id: string; state: unknown; revision: number };

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  throw new Error("unexpected result from db.execute");
}

/** Encrypts one row's state if the row is still at `row.revision` and still plain. Bumps the revision. */
async function encryptRow(db: AnyDb, vault: Vault, row: PlainRow): Promise<boolean> {
  const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
  const updated = rowsOf(
    await db.execute(sql`
      UPDATE games SET state = NULL, state_encrypted = ${vault.encryptJson(stateKeyId(row.id), STATE_FIELD, state)},
        revision = revision + 1
      WHERE id = ${row.id}::uuid AND revision = ${row.revision} AND state_encrypted IS NULL
      RETURNING id
    `),
  );
  return updated.length === 1;
}

/**
 * Encrypts every plain game state, `batchSize` rows at a time, paging by id so
 * each query reads at most one batch. Each state gets the same key the app
 * uses (`stateKeyId`, from the game id). A game that changed while it was being
 * encrypted is retried once at the end (a finished game saved by the old
 * deployment during a switch-over would otherwise stay plain).
 *
 * Returns how many were encrypted, how many were skipped on the first pass,
 * and how many are still plain after the retry (`left`: run it again).
 */
export async function encryptGameStates(
  db: AnyDb,
  vault: Vault,
  batchSize = 200,
): Promise<{ encrypted: number; skipped: number; left: number }> {
  let encrypted = 0;
  const skippedIds: string[] = [];
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, state, revision FROM games
        WHERE state_encrypted IS NULL AND id > ${lastId}::uuid ORDER BY id LIMIT ${batchSize}
      `),
    ) as PlainRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      if (await encryptRow(db, vault, row)) encrypted++;
      else skippedIds.push(row.id);
    }
    lastId = rows.at(-1)!.id;
  }

  let left = 0;
  for (const id of skippedIds) {
    const [row] = rowsOf(
      await db.execute(sql`SELECT id, state, revision FROM games WHERE id = ${id}::uuid AND state_encrypted IS NULL`),
    ) as PlainRow[];
    if (row === undefined) continue; // the app encrypted it when it saved, or it was deleted
    if (await encryptRow(db, vault, row)) encrypted++;
    else left++;
  }
  return { encrypted, skipped: skippedIds.length, left };
}

async function main(): Promise<void> {
  try {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) {
      console.error("DATABASE_URL_UNPOOLED is not set (see README.md → Database).");
      process.exitCode = 1;
      return;
    }
    assertDatabaseUrlRequiresTls(url, "DATABASE_URL_UNPOOLED");
    const vault = Vault.fromEnv();
    console.log(`Database host: ${new URL(url).host}`);
    const { db, close } = await connect(url);
    try {
      const { encrypted, skipped, left } = await encryptGameStates(db, vault);
      console.log(`Encrypted ${encrypted} game state(s); ${skipped} changed while this ran and were retried once.`);
      if (left > 0) {
        console.log(`${left} game state(s) are still plain because they kept changing. Run it again to finish them.`);
        process.exitCode = 1;
      }
    } finally {
      await close();
    }
  } catch (error) {
    if (error instanceof InsecureDatabaseUrlError || error instanceof EncryptionKeyError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (import.meta.main) await main();
