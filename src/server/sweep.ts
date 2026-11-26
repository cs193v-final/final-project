// Deletes expired sessions and rate-limit rows on a schedule (#154, security
// audit M2), and lobbies that are deleted, expired or never finished, and
// lobby uploads never made into a lobby (#67). Server-only.
//
// GET /api/cron/sweep is called once a day by Vercel Cron (`vercel.json`).
// Vercel sends `Authorization: Bearer <CRON_SECRET>` when the project has a
// CRON_SECRET variable; anything else gets a 401 before the database is
// touched, and so does every request when CRON_SECRET isn't set, so the route
// is never open to anyone who wants to make us do work.
import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { deleteExpiredRateLimits, deleteExpiredSessions, type PgDb } from "@/db/accounts";
import { deleteStaleUploads, purgeDeadLobbies } from "@/db/lobbies";
import { RATE_LIMITS } from "@/auth/accounts";
import { GAME_LIMITS, LOBBY_LIMITS, UPLOAD_MAX_AGE_MS } from "@/server/limits";

/**
 * How long a rate-limit row stays useful: the longest window of any limit
 * stored in `rate_limits`, login and sign-up (`RATE_LIMITS`) and games
 * (`GAME_LIMITS`, #85). A row whose window started earlier than this has
 * ended for every kind of limit, and `hitRateLimit` would start a fresh
 * window anyway. A new kind of limit in that table belongs in this list too.
 */
export const RATE_LIMIT_MAX_AGE_MS = Math.max(
  ...[...Object.values(RATE_LIMITS), ...Object.values(GAME_LIMITS), ...Object.values(LOBBY_LIMITS)].map((limit) => limit.windowMs),
);

export type SweepCounts = { sessions: number; rateLimits: number; lobbies: number; lobbyUploads: number };

/**
 * Whether an `Authorization` header carries the cron secret. False when no
 * secret is configured (empty or unset), so a missing variable never opens the
 * route. Both sides are hashed first so the comparison takes the same time
 * whatever their lengths, and `timingSafeEqual` compares the digests.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || authorization === null) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

/**
 * Deletes sessions that expired before `now`, rate-limit rows older than the
 * longest window, dead lobbies (`purgeDeadLobbies`: deleted, expired, owner
 * gone, or never finished; at most 50 a run) and lobby uploads older than
 * `UPLOAD_MAX_AGE_MS`.
 */
export async function sweepExpired(db: PgDb, now: Date): Promise<SweepCounts> {
  const sessions = await deleteExpiredSessions(db, now);
  const rateLimits = await deleteExpiredRateLimits(db, new Date(now.getTime() - RATE_LIMIT_MAX_AGE_MS));
  const lobbies = await purgeDeadLobbies(db, now);
  const lobbyUploads = await deleteStaleUploads(db, new Date(now.getTime() - UPLOAD_MAX_AGE_MS));
  return { sessions, rateLimits, lobbies, lobbyUploads };
}

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The response for `GET /api/cron/sweep`. `connect` is only called once the
 * request is authorized. The body is only the counts, never any row data.
 */
export async function sweepResponse(
  authorization: string | null,
  secret: string | undefined,
  connect: () => PgDb,
  now: Date,
): Promise<Response> {
  if (!isAuthorizedCron(authorization, secret)) {
    if (!secret) console.warn("cron sweep refused: CRON_SECRET is not set");
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const deleted = await sweepExpired(connect(), now);
  return Response.json({ deleted }, { headers: NO_STORE });
}
