// Encrypts the state of games stored before #84 (plain `games.state`).
// The app already reads those and encrypts each one the next time it's saved;
// this finishes the job for games nobody will save again (finished or
// abandoned ones), so no plain state is left. Run once per tier after
// migration 0005, with that tier's DATA_ENCRYPTION_KEY:
//
//   npm run db:encrypt-games
//
// Connects with DATABASE_URL_UNPOOLED, like the other db scripts: a value in
// the environment wins over .env.local. Safe to run again (it only touches
// rows that still have a plain state) and while players are playing (each
// update checks the row's revision, and skips a game that changed meanwhile;
// the app encrypts that one itself). Prints counts, never game data.
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

/**
 * Encrypts every plain game state, `batchSize` rows at a time, paging by id so
 * each query reads at most one batch. Each state gets the same key the app
 * uses (`stateKeyId`, from the game id). Returns how many were encrypted, and
 * how many were skipped because the game changed meanwhile.
 */
export async function encryptGameStates(db: AnyDb, vault: Vault, batchSize = 200): Promise<{ encrypted: number; skipped: number }> {
  let encrypted = 0;
  let skipped = 0;
  let lastId = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, state, revision FROM games
        WHERE state_encrypted IS NULL AND id > ${lastId}::uuid ORDER BY id LIMIT ${batchSize}
      `),
    ) as PlainRow[];
    if (rows.length === 0) return { encrypted, skipped };
    for (const row of rows) {
      const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
      const updated = rowsOf(
        await db.execute(sql`
          UPDATE games SET state = NULL, state_encrypted = ${vault.encryptJson(stateKeyId(row.id), STATE_FIELD, state)}
          WHERE id = ${row.id}::uuid AND revision = ${row.revision} AND state_encrypted IS NULL
          RETURNING id
        `),
      );
      if (updated.length === 1) encrypted++;
      else skipped++;
    }
    lastId = rows.at(-1)!.id;
  }
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
      const { encrypted, skipped } = await encryptGameStates(db, vault);
      console.log(`Encrypted ${encrypted} game state(s); skipped ${skipped} (changed meanwhile; the app encrypts those on save).`);
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
