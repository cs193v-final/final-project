// Account, session and rate-limit queries (#53), given a database client. The
// app goes through `src/auth/session.ts` and `src/auth/accounts.ts` (which use
// `getDb()`); the test-user script and the tests pass their own client. Like
// `./schema.ts`, this file has no "server-only" import so the script can load
// it, and relative imports keep `.ts` so Node can run it directly.
//
// Every function returns `PublicUser` (id and username), never a row with the
// password hash, except `findLoginRow`, which login needs to check a password.
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { PublicUser } from "../game/types.ts";
import { rateLimits, sessions, users } from "./schema.ts";
import type * as schema from "./schema.ts";

/** Any Drizzle Postgres client with our schema: Neon HTTP in the app, PGlite in tests. */
export type PgDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Inserts a user. Returns `null` if the username is taken, ignoring case.
 * `passwordHash` must already be a hash (see `hashPassword`).
 */
export async function insertUser(db: PgDb, username: string, passwordHash: string): Promise<PublicUser | null> {
  const [row] = await db
    .insert(users)
    .values({ username, passwordHash })
    // The only unique constraints are the id (random) and lower(username).
    .onConflictDoNothing()
    .returning({ id: users.id, username: users.username });
  return row ?? null;
}

/** The user row login needs, matched ignoring case, or `null`. */
export async function findLoginRow(
  db: PgDb,
  username: string,
): Promise<{ id: string; username: string; passwordHash: string } | null> {
  const [row] = await db
    .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.username})`, username.toLowerCase()));
  return row ?? null;
}

export async function insertSession(db: PgDb, tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
  await db.insert(sessions).values({ tokenHash, userId, expiresAt });
}

/** The session's user, if the session exists and hasn't expired at `now`. */
export async function findSessionUser(db: PgDb, tokenHash: string, now: Date): Promise<PublicUser | null> {
  const [row] = await db
    .select({ id: users.id, username: users.username })
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
