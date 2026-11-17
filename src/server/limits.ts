// Rate limits and caps on the game server (#85). Every value is here, so
// COST-CONTROLS.md (#86) and TECHNICAL.md can cite one place.
//
// Counters live in Postgres (`rate_limits`, #53's `hitRateLimit`): fixed
// windows, one atomic upsert per hit, so they hold across serverless
// instances. A hit over the limit throws `RateLimitedError`, which the game
// Server Actions return as `rate-limited` (nothing else happens: no game is
// created or changed).
//
// Keys (never a raw IP address or cookie token):
//   game:start:ip:<HMAC-SHA-256 of the IP>     game:start:owner:user:<users.id>
//   game:action:ip:<HMAC-SHA-256 of the IP>    game:start:owner:anon:<anon owner hash>
//   (and game:action:owner:... the same way)
// The anonymous owner hash is already the SHA-256 of a 32-byte random token
// (src/server/owner.ts), which can't be reversed; IPs need the keyed HMAC
// (src/server/ip-key.ts).
//
// Framework-free apart from the database client, so the tests pass PGlite and
// their own clock.
import { hitRateLimit, type PgDb } from "@/db/accounts";
import { RateLimitedError } from "@/game/game-result";
import type { GameOwner } from "@/game/server-game";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type Limit = { max: number; windowMs: number };

/**
 * The limits. A request is refused once the count in its window goes over
 * `max` (so `max` requests per window are allowed).
 *
 * Picked so normal play, a class demo behind one network, and the e2e suite
 * (every test from 127.0.0.1) never get near them: a game is 3 rounds of at
 * most a few zoom-outs, guesses and a "next", so a fast player sends about
 * 20 actions a game and a minute.
 */
export const GAME_LIMITS = {
  /** New games (and visits to /play that would start one) per player. */
  startsPerOwner: { max: 30, windowMs: HOUR },
  /** New games per IP address: also covers someone clearing cookies to get a new anonymous owner. */
  startsPerIp: { max: 300, windowMs: HOUR },
  /** Game actions (zoom out, guess, skip, next) and game loads per player. */
  actionsPerOwner: { max: 120, windowMs: MINUTE },
  /** Game actions and game loads per IP address. */
  actionsPerIp: { max: 600, windowMs: MINUTE },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof GAME_LIMITS;

/**
 * At most this many unfinished games per player (all packs). Starting
 * practice when the player already has this many resumes their latest
 * unfinished practice game instead of creating a row (see
 * src/server/games.ts), so the cap never leaves a player stuck.
 */
export const MAX_UNFINISHED_GAMES = 10;

/** The owner part of a key. Same id the `games` table stores. */
export function ownerKey(owner: GameOwner): string {
  return "userId" in owner ? `user:${owner.userId}` : `anon:${owner.anonId}`;
}

async function hit(db: PgDb, name: LimitName, key: string, now: Date): Promise<void> {
  const { max, windowMs } = GAME_LIMITS[name];
  if ((await hitRateLimit(db, key, windowMs, now)) > max) throw new RateLimitedError(name);
}

/**
 * Count one hit on the IP limit, then (only if that passed) on the owner
 * limit. IP first, so a client inventing owner cookies can't create
 * `rate_limits` rows faster than its IP limit.
 */
async function hitBoth(
  db: PgDb,
  kind: "start" | "action",
  owner: GameOwner,
  ipHash: string,
  now: Date,
): Promise<void> {
  const [ipLimit, ownerLimit]: [LimitName, LimitName] =
    kind === "start" ? ["startsPerIp", "startsPerOwner"] : ["actionsPerIp", "actionsPerOwner"];
  await hit(db, ipLimit, `game:${kind}:ip:${ipHash}`, now);
  await hit(db, ownerLimit, `game:${kind}:owner:${ownerKey(owner)}`, now);
}

/** Before starting (or reusing) a game. Throws `RateLimitedError` over a limit. */
export function checkStartLimits(db: PgDb, owner: GameOwner, ipHash: string, now: Date): Promise<void> {
  return hitBoth(db, "start", owner, ipHash, now);
}

/** Before a game action or load. Throws `RateLimitedError` over a limit. */
export function checkActionLimits(db: PgDb, owner: GameOwner, ipHash: string, now: Date): Promise<void> {
  return hitBoth(db, "action", owner, ipHash, now);
}
