// Creates a test user (#53), so each teammate can play the full flow with
// their own account. The password is read from TEST_USER_PASSWORD, never from
// the command line (which lands in shell history):
//
//   # in .env.local (git-ignored):  TEST_USER_PASSWORD=<your test password>
//   npm run db:test-user -- <username>
//
// Connects with DATABASE_URL_UNPOOLED, like drizzle.config.ts: a value already
// in the environment wins; only when it's unset does it fall back to the dev
// database in .env.local. TLS is required (localhost exempt, src/db/tls.ts).
// Prints only the database host, never credentials.
//
// Runs with plain Node (type stripping), so imports are relative with `.ts`.
import { existsSync } from "node:fs";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { hashPassword } from "../src/auth/crypto.ts";
import { checkNewPassword, checkUsername } from "../src/auth/rules.ts";
import { insertUser, type PgDb } from "../src/db/accounts.ts";
import * as schema from "../src/db/schema.ts";
import { assertDatabaseUrlRequiresTls, InsecureDatabaseUrlError } from "../src/db/tls.ts";

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
export async function createTestUser(db: PgDb, input: { username: string; password: string }): Promise<string> {
  const user = await insertUser(db, input.username, await hashPassword(input.password));
  return user
    ? `Created test user "${user.username}". Log in at /login.`
    : `A user named "${input.username}" already exists (ignoring case); nothing changed.`;
}

async function main(): Promise<void> {
  try {
    if (existsSync(".env.local")) {
      const before = process.env.DATABASE_URL_UNPOOLED;
      process.loadEnvFile(".env.local");
      // A URL already in the environment wins over .env.local.
      if (before !== undefined) process.env.DATABASE_URL_UNPOOLED = before;
    }
    const input = parseInput(process.argv.slice(2), process.env.TEST_USER_PASSWORD);
    const url = process.env.DATABASE_URL_UNPOOLED;
    if (!url) throw new UsageError("DATABASE_URL_UNPOOLED is not set (see README.md → Database).");
    assertDatabaseUrlRequiresTls(url, "DATABASE_URL_UNPOOLED");
    console.log(`Database host: ${new URL(url).host}`);
    const db = drizzle({ client: neon(url), schema }) as unknown as PgDb;
    console.log(await createTestUser(db, input));
  } catch (error) {
    if (error instanceof UsageError || error instanceof InsecureDatabaseUrlError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (import.meta.main) await main();
