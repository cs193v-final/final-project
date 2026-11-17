// Account, session and rate-limit queries (#53), given a database client. The
// app goes through `src/auth/session.ts` and `src/auth/accounts.ts` (which use
// `getDb()`); the test-user script and the tests pass their own client. Like
// `./schema.ts`, this file has no "server-only" import so the script can load
// it, and relative imports keep `.ts` so Node can run it directly.
//
// Usernames are encrypted (#84): these functions only ever see the encrypted
// username and its keyed hash (`usernameIndex`). Encrypting and decrypting is
// done by `src/auth/accounts.ts`, which has the key. No function returns the
// password hash except `findLoginRow`, which login needs to check a password.
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { rateLimits, sessions, users } from "./schema.ts";
import type * as schema from "./schema.ts";

/** Any Drizzle Postgres client with our schema: Neon HTTP in the app, PGlite in tests. */
export type PgDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A user row as stored: the username is encrypted. */
export type StoredUser = { id: string; usernameEncrypted: string };

/**
 * Inserts a user. Returns `false` if the username is taken (same
 * `usernameIndex`, i.e. the same name ignoring case). The caller picks the id,
 * because the username is encrypted with a key derived from it.
 * `passwordHash` must already be a hash (see `hashPassword`).
 */
export async function insertUser(
  db: PgDb,
  user: { id: string; usernameEncrypted: string; usernameIndex: string; passwordHash: string },
): Promise<boolean> {
  const rows = await db
    .insert(users)
    .values(user)
    // The only unique constraints are the id (random) and the username index.
    .onConflictDoNothing()
    .returning({ id: users.id });
  return rows.length > 0;
}

/** The user row login needs, by the username's keyed hash, or `null`. */
export async function findLoginRow(
  db: PgDb,
  usernameIndex: string,
): Promise<(StoredUser & { passwordHash: string }) | null> {
  const [row] = await db
    .select({ id: users.id, usernameEncrypted: users.usernameEncrypted, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.usernameIndex, usernameIndex));
  return row ?? null;
}

export async function insertSession(db: PgDb, tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
  await db.insert(sessions).values({ tokenHash, userId, expiresAt });
}

/** The session's user (username still encrypted), if the session exists and hasn't expired at `now`. */
export async function findSessionUser(db: PgDb, tokenHash: string, now: Date): Promise<StoredUser | null> {
  const [row] = await db
    .select({ id: users.id, usernameEncrypted: users.usernameEncrypted })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  return row ?? null;
}

export async function deleteSession(db: PgDb, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Removes every expired session. Returns how many were removed. */
export async function deleteExpiredSessions(db: PgDb, now: Date): Promise<number> {
  const removed = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ t: sessions.tokenHash });
  return removed.length;
}

/**
 * Counts one hit on `key` in a fixed window and returns the count so far in
 * the current window (including this hit). One statement, so two requests at
 * once can't both read the old count. A window older than `windowMs` restarts
 * at 1.
 */
export async function hitRateLimit(db: PgDb, key: string, windowMs: number, now: Date): Promise<number> {
  const windowOpen = new Date(now.getTime() - windowMs);
  const expired = sql`${rateLimits.windowStart} <= ${windowOpen.toISOString()}::timestamptz`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN ${now.toISOString()}::timestamptz ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count });
  return row!.count;
}

/** Forgets the hits on `key`, e.g. a username's failed logins after a successful one. */
export async function clearRateLimit(db: PgDb, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/** Removes rate-limit rows whose window started before `before`. */
export async function deleteExpiredRateLimits(db: PgDb, before: Date): Promise<number> {
  const removed = await db.delete(rateLimits).where(lt(rateLimits.windowStart, before)).returning({ k: rateLimits.key });
  return removed.length;
}
