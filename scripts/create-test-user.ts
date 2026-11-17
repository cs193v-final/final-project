// Creates a test user (#53), so each teammate can play the full flow with
// their own account. The password is read from TEST_USER_PASSWORD, never from
// the command line (which lands in shell history):
//
//   # in .env.local (git-ignored):  TEST_USER_PASSWORD=<your test password>
//   npm run db:test-user -- <username>
//
// Connects with DATABASE_URL_UNPOOLED, like drizzle.config.ts: a value already
// in the environment wins; only when it's unset does it fall back to the dev
// database in .env.local. TLS is required (localhost exempt, src/db/tls.ts),
// and the driver follows the host like the seed script's (`connect` in
// ./seed-db.ts): Neon's HTTP driver for Neon, node-postgres for a local one.
// Prints only the database host, never credentials. The username is stored
// encrypted (#84), so DATA_ENCRYPTION_KEY must be the same key the app uses.
//
// Runs with plain Node (type stripping), so imports are relative with `.ts`.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { USERNAME_FIELD, usernameIndex } from "../src/auth/accounts.ts";
import { hashPassword } from "../src/auth/crypto.ts";
import { EncryptionKeyError, Vault } from "../src/crypto/vault.ts";
import { checkNewPassword, checkUsername } from "../src/auth/rules.ts";
import { insertUser, type PgDb } from "../src/db/accounts.ts";
import { assertDatabaseUrlRequiresTls, InsecureDatabaseUrlError } from "../src/db/tls.ts";
import { connect } from "./seed-db.ts";

export const USAGE = "Usage: TEST_USER_PASSWORD=... npm run db:test-user -- <username>\n(put TEST_USER_PASSWORD in .env.local)";

export class UsageError extends Error {
  constructor(message: string) {
    super(`${message}\n\n${USAGE}`);
    this.name = "UsageError";
  }
}

/** Checks the arguments and password with the same rules as sign-up. */
export function parseInput(args: readonly string[], password: string | undefined): { username: string; password: string } {
  if (args.length !== 1) throw new UsageError("Give exactly one username.");
  const username = checkUsername(args[0]);
  if (!username.ok) throw new UsageError(username.error);
  const pw = checkNewPassword(password);
  if (!pw.ok) throw new UsageError(`TEST_USER_PASSWORD: ${pw.error}`);
  return { username: username.value, password: pw.value };
}

/** Creates the user and returns what to print. An existing user is left unchanged. */
export async function createTestUser(
  db: PgDb,
  vault: Vault,
  input: { username: string; password: string },
): Promise<string> {
  const id = randomUUID();
  const created = await insertUser(db, {
    id,
    usernameEncrypted: vault.encrypt(id, USERNAME_FIELD, input.username),
    usernameIndex: usernameIndex(vault, input.username),
    passwordHash: await hashPassword(input.password),
  });
  return created
    ? `Created test user "${input.username}". Log in at /login.`
    : `A user named "${input.username}" already exists (ignoring case); nothing changed.`;
}

async function main(): Promise<void> {
  try {
    // loadEnvFile never overwrites a variable already in the environment, so
    // a URL set in the shell wins over .env.local.
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const input = parseInput(process.argv.slice(2), process.env.TEST_USER_PASSWORD);
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new UsageError("DATABASE_URL_UNPOOLED is not set (see README.md → Database).");
    assertDatabaseUrlRequiresTls(url, "DATABASE_URL_UNPOOLED");
    const vault = Vault.fromEnv();
    console.log(`Database host: ${new URL(url).host}`);
    const { db, close } = await connect(url);
    try {
      console.log(await createTestUser(db as unknown as PgDb, vault, input));
    } finally {
      await close();
    }
  } catch (error) {
    if (error instanceof UsageError || error instanceof InsecureDatabaseUrlError || error instanceof EncryptionKeyError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (import.meta.main) await main();
