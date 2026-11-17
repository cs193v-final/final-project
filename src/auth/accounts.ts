// Register and log in (#53): the rules, hashing and rate limits, given a
// database client. Cookies live in `./session.ts`; this file never touches the
// request, so it's tested directly against PGlite.
import {
  clearRateLimit,
  findLoginRow,
  hitRateLimit,
  insertSession,
  insertUser,
  type PgDb,
} from "@/db/accounts";
import type { PublicUser } from "@/game/types";

import { getDummyPasswordHash, hashPassword, newToken, sha256Hex, verifyPassword } from "./crypto";
import { checkNewPassword, checkUsername, hasSpaces, usernameKey } from "./rules";

export const SESSION_DAYS = 30;

// Compute the dummy hash when the server starts, not on the first login with
// an unknown username, so that first login isn't slower than the rest.
getDummyPasswordHash().catch(() => {});
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

/**
 * The database, or a function that returns it. Input is validated before the
 * database is touched, so the app passes `getDb` and a bad form never needs a
 * connection.
 */
export type DbSource = PgDb | (() => PgDb);
const resolve = (source: DbSource): PgDb => (typeof source === "function" ? source() : source);

export type FieldErrors = { username?: string; password?: string };

export type AuthResult =
  | { ok: true; user: PublicUser; session: { token: string; expiresAt: Date } }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "taken"; errors: FieldErrors }
  | { ok: false; reason: "wrong-credentials"; message: string }
  | { ok: false; reason: "rate-limited"; message: string };

/**
 * Whether the per-address limits apply. On Vercel always: its edge sets the
 * client's real address. Anywhere else (`next dev`, CI's `next start`), Next
 * fills the address in from the socket, so every request from this machine
 * shares one loopback address, or none; one shared count there would lock all
 * local and e2e runs out of sign-up after 5 accounts an hour. The
 * per-username login limit still applies.
 */
export function limitsAddress(ip: string | null, onVercel = Boolean(process.env.VERCEL)): boolean {
  if (onVercel) return true;
  if (ip === null) return false;
  const address = ip.toLowerCase().replace(/^::ffff:/, "");
  return !(address === "::1" || address === "localhost" || /^127\./.test(address));
}

export const ipKey = (prefix: string, ip: string | null) => `${prefix}:ip:${ip ? sha256Hex(ip) : "unknown"}`;
/**
 * Hashed, never the typed name: people type emails, or their password, into
 * the username box, and this row is written before we know the user exists.
 */
export const loginUserKey = (username: string) => `login:user:${sha256Hex(usernameKey(username))}`;

const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";
const WRONG_CREDENTIALS = "That username and password don't match.";
const USERNAMES_HAVE_NO_SPACES = "Usernames don't have spaces. Check the username you signed up with.";

async function startSession(db: PgDb, user: PublicUser, now: Date): Promise<AuthResult> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
  await insertSession(db, sha256Hex(token), user.id, expiresAt);
  return { ok: true, user, session: { token, expiresAt } };
}

export async function register(
  source: DbSource,
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

  const db = resolve(source);
  const { max, windowMs } = RATE_LIMITS.registerPerIp;
  if (limitsAddress(req.ip) && (await hitRateLimit(db, ipKey("register", req.ip), windowMs, req.now)) > max) {
    return { ok: false, reason: "rate-limited", message: RATE_LIMITED };
  }

  const user = await insertUser(db, username.value, await hashPassword(password.value));
  if (!user) return { ok: false, reason: "taken", errors: { username: "That username is taken." } };
  return startSession(db, user, req.now);
}

export async function login(
  source: DbSource,
  input: { username: unknown; password: unknown },
  req: RequestInfo,
): Promise<AuthResult> {
  // Just require something in both fields; "invalid" is only for empty ones
  // (and a username with a space, below).
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

  // No account can have a name that breaks the username rules (they've been
  // the same since accounts started), so that's a wrong login, decided
  // without the database. This also keeps very long input out of the
  // rate-limit table, where a key over Postgres's index limit was an error.
  // A name with a space gets a hint instead (#133): people type their full
  // name, and since no username has one, saying so reveals nothing.
  if (hasSpaces(username)) return { ok: false, reason: "invalid", errors: { username: USERNAMES_HAVE_NO_SPACES } };
  if (!checkUsername(username).ok) return { ok: false, reason: "wrong-credentials", message: WRONG_CREDENTIALS };

  const db = resolve(source);
  // Count the attempt before checking the password, so a blocked client learns
  // nothing about whether its guess was right. The address first: a client
  // that's over its own limit stops here, without adding to the username's
  // count, so it can't keep locking someone else's account.
  if (limitsAddress(req.ip)) {
    const ipHits = await hitRateLimit(db, ipKey("login", req.ip), RATE_LIMITS.loginPerIp.windowMs, req.now);
    if (ipHits > RATE_LIMITS.loginPerIp.max) return { ok: false, reason: "rate-limited", message: RATE_LIMITED };
  }
  const userHits = await hitRateLimit(db, loginUserKey(username), RATE_LIMITS.loginPerUser.windowMs, req.now);
  if (userHits > RATE_LIMITS.loginPerUser.max) return { ok: false, reason: "rate-limited", message: RATE_LIMITED };

  const row = await findLoginRow(db, username);
  // Unknown username: still run one hash, so timing doesn't reveal which usernames exist.
  const matches = await verifyPassword(password.slice(0, 1024), row?.passwordHash ?? (await getDummyPasswordHash()));
  if (!row || !matches) return { ok: false, reason: "wrong-credentials", message: WRONG_CREDENTIALS };

  await clearRateLimit(db, loginUserKey(username));
  return startSession(db, { id: row.id, username: row.username }, req.now);
}
