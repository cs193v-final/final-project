// Register and log in (#53): the rules, hashing and rate limits, given a
// database client. Cookies live in `./session.ts`; this file never touches the
// request, so it's tested directly against PGlite.
import type { PublicUser } from "../game/types.ts";
import {
  clearRateLimit,
  findLoginRow,
  hitRateLimit,
  insertSession,
  insertUser,
  type PgDb,
} from "../db/accounts.ts";
import { getDummyPasswordHash, hashPassword, newSessionToken, sha256Hex, verifyPassword } from "./crypto.ts";
import { checkNewPassword, checkUsername, usernameKey } from "./rules.ts";

export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Login and sign-up limits. Fixed windows, counted in `rate_limits`.
 * - Per username: stops guessing one account's password from many addresses.
 *   A successful login clears it.
 * - Per address: stops one client trying many usernames.
 */
export const RATE_LIMITS = {
  loginPerUser: { max: 10, windowMs: 15 * 60 * 1000 },
  loginPerIp: { max: 30, windowMs: 15 * 60 * 1000 },
  registerPerIp: { max: 5, windowMs: 60 * 60 * 1000 },
} as const;

/** Where a request came from. `ip` may be null (unknown); it's only ever stored hashed. */
export type RequestInfo = { ip: string | null; now: Date };

export type FieldErrors = { username?: string; password?: string };

export type AuthResult =
  | { ok: true; user: PublicUser; session: { token: string; expiresAt: Date } }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "taken"; errors: FieldErrors }
  | { ok: false; reason: "wrong-credentials"; message: string }
  | { ok: false; reason: "rate-limited"; message: string };

const ipKey = (prefix: string, ip: string | null) => `${prefix}:ip:${ip ? sha256Hex(ip) : "unknown"}`;
const loginUserKey = (username: string) => `login:user:${usernameKey(username)}`;

const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";
const WRONG_CREDENTIALS = "That username and password don't match.";

async function startSession(db: PgDb, user: PublicUser, now: Date): Promise<AuthResult> {
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
  await insertSession(db, sha256Hex(token), user.id, expiresAt);
  return { ok: true, user, session: { token, expiresAt } };
}

export async function register(
  db: PgDb,
  input: { username: unknown; password: unknown },
  req: RequestInfo,
): Promise<AuthResult> {
  const username = checkUsername(input.username);
  const password = checkNewPassword(input.password);
  if (!username.ok || !password.ok) {
    return {
      ok: false,
      reason: "invalid",
      errors: {
        ...(username.ok ? {} : { username: username.error }),
        ...(password.ok ? {} : { password: password.error }),
      },
    };
  }

  const { max, windowMs } = RATE_LIMITS.registerPerIp;
  if ((await hitRateLimit(db, ipKey("register", req.ip), windowMs, req.now)) > max) {
    return { ok: false, reason: "rate-limited", message: RATE_LIMITED };
  }

  const user = await insertUser(db, username.value, await hashPassword(password.value));
  if (!user) return { ok: false, reason: "taken", errors: { username: "That username is taken." } };
  return startSession(db, user, req.now);
}

export async function login(
  db: PgDb,
  input: { username: unknown; password: unknown },
  req: RequestInfo,
): Promise<AuthResult> {
  // Don't apply the new-account rules here (an old account may predate a rule
  // change); just require something in both fields.
  const username = typeof input.username === "string" ? input.username.normalize("NFKC").trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (username === "" || password === "") {
    return {
      ok: false,
      reason: "invalid",
      errors: {
        ...(username === "" ? { username: "Enter your username." } : {}),
        ...(password === "" ? { password: "Enter your password." } : {}),
      },
    };
  }

  // Count the attempt against both limits before checking the password, so a
  // blocked client learns nothing about whether its guess was right.
  const userHits = await hitRateLimit(db, loginUserKey(username), RATE_LIMITS.loginPerUser.windowMs, req.now);
  const ipHits = await hitRateLimit(db, ipKey("login", req.ip), RATE_LIMITS.loginPerIp.windowMs, req.now);
  if (userHits > RATE_LIMITS.loginPerUser.max || ipHits > RATE_LIMITS.loginPerIp.max) {
    return { ok: false, reason: "rate-limited", message: RATE_LIMITED };
  }

  const row = await findLoginRow(db, username);
  // Unknown username: still run one hash, so timing doesn't reveal which usernames exist.
  const matches = await verifyPassword(password.slice(0, 1024), row?.passwordHash ?? (await getDummyPasswordHash()));
  if (!row || !matches) return { ok: false, reason: "wrong-credentials", message: WRONG_CREDENTIALS };

  await clearRateLimit(db, loginUserKey(username));
  return startSession(db, { id: row.id, username: row.username }, req.now);
}
