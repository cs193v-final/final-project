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
import type { GameOwner } from "../src/game/server-game.ts";
import { connect } from "./seed-db.ts";

type PlainRow = { id: string; user_id: string | null; anon_owner_hash: string | null; state: unknown; revision: number };

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  throw new Error("unexpected result from db.execute");
}

/** Encrypts every plain game state, a batch at a time. Returns how many were encrypted and skipped. */
export async function encryptGameStates(db: AnyDb, vault: Vault, batchSize = 200): Promise<{ encrypted: number; skipped: number }> {
  let encrypted = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (;;) {
    const rows = rowsOf(
      await db.execute(sql`
        SELECT id, user_id, anon_owner_hash, state, revision FROM games
        WHERE state_encrypted IS NULL ORDER BY id LIMIT ${batchSize + seen.size}
      `),
    ) as PlainRow[];
    const todo = rows.filter((r) => !seen.has(r.id));
    if (todo.length === 0) return { encrypted, skipped };
    for (const row of todo) {
      seen.add(row.id);
      const owner: GameOwner | null =
        row.user_id !== null ? { userId: row.user_id } : row.anon_owner_hash !== null ? { anonId: row.anon_owner_hash } : null;
      if (owner === null) {
        skipped++;
        continue;
      }
      const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
      const updated = rowsOf(
        await db.execute(sql`
          UPDATE games SET state = NULL, state_encrypted = ${vault.encryptJson(stateKeyId(owner, row.id), STATE_FIELD, state)}
          WHERE id = ${row.id}::uuid AND revision = ${row.revision} AND state_encrypted IS NULL
          RETURNING id
        `),
      );
      if (updated.length === 1) encrypted++;
      else skipped++;
    }
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
      console.log(`Encrypted ${encrypted} game state(s); skipped ${skipped} (changed meanwhile, or no owner).`);
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
