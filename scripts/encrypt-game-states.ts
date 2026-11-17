// Encrypts the state of games stored before #84 (plain `games.state`).
// The app already reads those and encrypts each one the next time it's saved;
// this finishes the job for games nobody will save again (finished or
// abandoned ones), so no plain state is left. Run once per tier after
// migration 0006, with that tier's DATA_ENCRYPTION_KEY:
//
//   npm run db:encrypt-games
//
// Connects with DATABASE_URL_UNPOOLED, like the other db scripts: a value in
// the environment wins over .env.local. The URL and DATA_ENCRYPTION_KEY must
// come from the same place (both from the environment, or both from
// .env.local), and the key must decrypt a value already in that database, if
// there is one: otherwise it refuses, because encrypting with the wrong tier's
// key and dropping the plain copy would lose those games for good. Safe to run again (it only touches
// rows that still have a plain state) and while players are playing: each
// update checks the row's revision and bumps it, so a save racing it gets the
// normal conflict-and-reload path. A game that changed meanwhile is retried
// once at the end; if it's still plain after that, the script says to run it
// again. Prints counts, never game data.
//
// Runs with plain Node (type stripping), so imports are relative with `.ts`.
import { existsSync } from "node:fs";

import { sql } from "drizzle-orm";

import { USERNAME_FIELD } from "../src/auth/user-row.ts";
import { DecryptionError, ENCRYPTION_KEY_ENV, EncryptionKeyError, Vault } from "../src/crypto/vault.ts";
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

const URL_ENV = "DATABASE_URL_UNPOOLED";

/**
 * Says why the run must stop when the database URL and the encryption key came
 * from different places, e.g. a production URL in the environment and the dev
 * key filled in from .env.local. `before` is the environment before
 * .env.local was loaded, `after` the one after. Undefined when they match.
 */
export function keySourceProblem(
  before: Record<string, string | undefined>,
  after: Record<string, string | undefined>,
): string | undefined {
  if (!after[URL_ENV] || !after[ENCRYPTION_KEY_ENV]) return undefined; // reported as missing elsewhere
  const urlFromEnv = Boolean(before[URL_ENV]);
  const keyFromEnv = Boolean(before[ENCRYPTION_KEY_ENV]);
  if (urlFromEnv === keyFromEnv) return undefined;
  const [fromEnv, fromFile] = urlFromEnv ? [URL_ENV, ENCRYPTION_KEY_ENV] : [ENCRYPTION_KEY_ENV, URL_ENV];
  return (
    `${fromEnv} came from the environment but ${fromFile} came from .env.local, so they may be for different ` +
    `databases. Set both in the environment (or neither) and run it again. Nothing was changed.`
  );
}

/** The key doesn't decrypt a value already stored in this database: it's another tier's key. */
export class KeyMismatchError extends Error {
  constructor() {
    super(
      `${ENCRYPTION_KEY_ENV} doesn't decrypt the data already in this database, so it's probably another tier's key. ` +
        "Nothing was changed.",
    );
    this.name = "KeyMismatchError";
  }
}

/**
 * Throws `KeyMismatchError` unless `vault` decrypts one encrypted game state
 * and one username already in the database. Passes when there are none yet
 * (nothing to compare with; `keySourceProblem` still applies).
 */
export async function assertKeyMatchesDatabase(db: AnyDb, vault: Vault): Promise<void> {
  const [game] = rowsOf(
    await db.execute(sql`SELECT id, state_encrypted FROM games WHERE state_encrypted IS NOT NULL LIMIT 1`),
  ) as { id: string; state_encrypted: string }[];
  const [user] = rowsOf(await db.execute(sql`SELECT id, username_encrypted FROM users LIMIT 1`)) as {
    id: string;
    username_encrypted: string;
  }[];
  try {
    if (game) vault.decrypt(stateKeyId(game.id), STATE_FIELD, game.state_encrypted);
    if (user) vault.decrypt(user.id, USERNAME_FIELD, user.username_encrypted);
  } catch (error) {
    if (error instanceof DecryptionError) throw new KeyMismatchError();
    throw error;
  }
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
 * First checks the key against the database (`assertKeyMatchesDatabase`) and
 * changes nothing if it doesn't match.
 *
 * Returns how many were encrypted, how many were skipped on the first pass,
 * and how many are still plain after the retry (`left`: run it again).
 */
export async function encryptGameStates(
  db: AnyDb,
  vault: Vault,
  batchSize = 200,
): Promise<{ encrypted: number; skipped: number; left: number }> {
  await assertKeyMatchesDatabase(db, vault);
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
    const before = { ...process.env };
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const problem = keySourceProblem(before, process.env);
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
      return;
    }
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
    if (
      error instanceof InsecureDatabaseUrlError ||
      error instanceof EncryptionKeyError ||
      error instanceof KeyMismatchError
    ) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (import.meta.main) await main();
