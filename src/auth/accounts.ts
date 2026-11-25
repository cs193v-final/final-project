// Register and log in (#53): the rules, hashing and rate limits, given a
// database client. Cookies live in `./session.ts`; this file never touches the
// request, so it's tested directly against PGlite.
//
// Encryption (#84): usernames are stored encrypted with the user's own key,
// and looked up by a keyed hash. Rate-limit keys use keyed hashes too, so the
// database never holds a username or an IP address in a form anyone without
// the key can read or recompute. See src/crypto/vault.ts.
import { randomBytes, timingSafeEqual } from "node:crypto";

import {
  clearRateLimit,
  deleteSession,
  findLoginRow,
  findSessionUser,
  hitRateLimit,
  insertSession,
  insertUser,
  type PgDb,
  trimSessions,
  type StoredUser,
} from "@/db/accounts";
import { DecryptionError, getVault, resolveVault, type Vault, type VaultSource } from "@/crypto/vault";
import type { PublicUser } from "@/game/types";

import { getDummyPasswordHash, hashPassword, newToken, sha256Hex, verifyPassword } from "./crypto";
import { limitsAddress } from "./limits-address";
import { rateLimitAddress } from "./rate-limit-address";
import { checkNewPassword, checkUsername, loginUsernameHint, usernameKey } from "./rules";
import { newUserRow, USERNAME_FIELD, usernameIndex } from "./user-row";

export { USERNAME_FIELD, usernameIndex };

/**
 * Keyed-hash purposes, as passed to the vault. Changing a rate-limit one only
 * resets its counters; changing `device` stops every device token being
 * trusted, so their owners are back under the per-username limit until they
 * next log in.
 */
const PURPOSE = {
  loginUser: "rate-limit.login-user",
  loginDevice: "rate-limit.login-device",
  ip: "rate-limit.ip",
  device: "login.device",
} as const;

/** A stored user as the app sees it: the username decrypted. */
export const toPublicUser = (vault: Vault, row: StoredUser): PublicUser => ({
  id: row.id,
  username: vault.decrypt(row.id, USERNAME_FIELD, row.usernameEncrypted),
});

/**
 * The session's user, decrypted, if the session exists and hasn't expired at
 * `now`. A username that doesn't decrypt (the tier's key was changed or set
 * wrong, or the row is corrupt) counts as logged out, like a missing session:
 * the session is deleted, best effort, and the cookie then matches nothing.
 * Only database errors throw.
 */
export async function sessionUser(db: PgDb, vault: Vault, tokenHash: string, now: Date): Promise<PublicUser | null> {
  const row = await findSessionUser(db, tokenHash, now);
  if (!row) return null;
  try {
    return toPublicUser(vault, row);
  } catch (error) {
    if (!(error instanceof DecryptionError)) throw error;
    console.error("A session's username couldn't be decrypted (is DATA_ENCRYPTION_KEY right for this tier?); ending that session");
    await deleteSession(db, tokenHash).catch(() => {});
    return null;
  }
}

export const SESSION_DAYS = 30;

/**
 * Live sessions one user can have (audit L4, #156). Starting another ends the
 * oldest ones, so a stolen session can't outlive many logins elsewhere and an
 * account can't pile up rows. Expired sessions are deleted at the same time.
 */
export const MAX_SESSIONS_PER_USER = 10;

// Compute the dummy hash when the server starts, not on the first login with
// an unknown username, so that first login isn't slower than the rest.
getDummyPasswordHash().catch(() => {});
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Login and sign-up limits. Fixed windows, counted in `rate_limits`.
 * - Per username: stops guessing one account's password from many addresses.
 *   A successful login clears it.
 * - Per device token (#151): a browser that has logged into this username
 *   before counts here instead of per username, so other people's guesses
 *   can't lock its owner out. See `isDeviceTokenFor`.
 * - Per address: stops one client trying many usernames.
 */
export const RATE_LIMITS = {
  loginPerUser: { max: 10, windowMs: 15 * 60 * 1000 },
  loginPerDevice: { max: 10, windowMs: 15 * 60 * 1000 },
  loginPerIp: { max: 30, windowMs: 15 * 60 * 1000 },
  registerPerIp: { max: 5, windowMs: 60 * 60 * 1000 },
} as const;

/**
 * Where a request came from. `ip` may be null (unknown); it's only ever stored
 * hashed. `device` is the browser's device-token cookie, if it sent one
 * (untrusted until `isDeviceTokenFor` says otherwise).
 */
export type RequestInfo = { ip: string | null; now: Date; device?: string | null };

/**
 * The database, or a function that returns it. Input is validated before the
 * database is touched, so the app passes `getDb` and a bad form never needs a
 * connection.
 */
export type DbSource = PgDb | (() => PgDb);
const resolve = (source: DbSource): PgDb => (typeof source === "function" ? source() : source);

export type FieldErrors = { username?: string; password?: string };

export type AuthResult =
  | { ok: true; user: PublicUser; session: { token: string; expiresAt: Date }; device: string }
  | { ok: false; reason: "invalid"; errors: FieldErrors }
  | { ok: false; reason: "taken"; errors: FieldErrors }
  | { ok: false; reason: "wrong-credentials"; message: string }
  | { ok: false; reason: "rate-limited"; message: string };

// `limitsAddress` lives in ./limits-address.ts so the game server (#85) can use
// it without loading this module (and its argon2 warm-up).
export { limitsAddress };

/**
 * Keyed hashes (#84), never the typed name or a raw IP: people type emails,
 * or their password, into the username box, and this row is written before
 * we know the user exists. An IPv6 address counts by its /64 (#150), so
 * rotating within one doesn't get a fresh limit; see `rateLimitAddress`.
 */
export const ipKey = (vault: Vault, prefix: string, ip: string | null) =>
  `${prefix}:ip:${ip ? vault.blindIndex(PURPOSE.ip, rateLimitAddress(ip)) : "unknown"}`;
export const loginUserKey = (vault: Vault, username: string) =>
  `login:user:${vault.blindIndex(PURPOSE.loginUser, usernameKey(username))}`;
/** The rate-limit key of one device token, a keyed hash of its random part. Only for a token `isDeviceTokenFor` accepted. */
export const loginDeviceKey = (vault: Vault, token: string) =>
  `login:device:${vault.blindIndex(PURPOSE.loginDevice, token.split(".")[0] ?? "")}`;

/**
 * Device tokens (#151, the "device cookie" defence from OWASP's
 * authentication cheat sheet). A successful sign-up or login gives the browser
 * `<random>.<day made>.<HMAC of the username, the random part and the day>`,
 * stored in a cookie. Nothing is stored on the server: the HMAC key is the
 * vault's, so only we can make a token, and one is only good for the username
 * it was made for, for `DEVICE_TOKEN_DAYS` from the day it was made. It doesn't
 * contain the username, only a keyed hash that can't be reversed.
 *
 * Login attempts that bring a valid token count against that token's own limit
 * instead of the username's. So someone guessing from elsewhere can lock out
 * only browsers that have never logged into the account, and a stolen token
 * buys no more than `RATE_LIMITS.loginPerDevice` guesses per window. A login
 * that brings a valid token keeps it rather than getting another, so logging
 * in again doesn't add a budget.
 *
 * Nothing can revoke a token before it expires. Whoever adds password change
 * or account deletion must make them invalidate the account's tokens, e.g. by
 * putting a per-user counter in the HMAC and bumping it.
 */
export const DEVICE_TOKEN_DAYS = 365;
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{22}\.\d{1,7}\.[0-9a-f]{64}$/;
const dayNumber = (now: Date) => Math.floor(now.getTime() / DAY_MS);
const deviceMac = (vault: Vault, username: string, nonce: string, day: string) =>
  vault.blindIndex(PURPOSE.device, `${usernameKey(username)}\0${nonce}\0${day}`);

export function newDeviceToken(vault: Vault, username: string, now: Date): string {
  const nonce = randomBytes(16).toString("base64url");
  const day = String(dayNumber(now));
  return `${nonce}.${day}.${deviceMac(vault, username, nonce, day)}`;
}

/** Whether `token` is a device token this server made for `username` (any case), still in date at `now`. Never throws. */
export function isDeviceTokenFor(vault: Vault, username: string, token: unknown, now: Date): token is string {
  if (typeof token !== "string" || !DEVICE_TOKEN.test(token)) return false;
  const [nonce, day, mac] = token.split(".") as [string, string, string];
  const age = dayNumber(now) - Number(day);
  // Check the MAC whatever the age, so the time taken says nothing about the day.
  const genuine = timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(deviceMac(vault, username, nonce, day), "hex"));
  return genuine && age >= 0 && age < DEVICE_TOKEN_DAYS;
}

const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";
const WRONG_CREDENTIALS = "That username and password don't match.";

/** `device` is the browser's token if `login` trusted it (kept, see above); otherwise a new one is made. */
async function startSession(db: PgDb, vault: Vault, user: PublicUser, now: Date, device?: string): Promise<AuthResult> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
  const tokenHash = sha256Hex(token);
  await insertSession(db, tokenHash, user.id, expiresAt);
  // After the insert, so each login's trim sees every session inserted before
  // it (its own included) and never deletes its own; logins at the same
  // moment can't leave more than the cap once both have finished.
  await trimSessions(db, user.id, tokenHash, MAX_SESSIONS_PER_USER, now);
  return { ok: true, user, session: { token, expiresAt }, device: device ?? newDeviceToken(vault, user.username, now) };
}

export async function register(
  source: DbSource,
  input: { username: unknown; password: unknown },
  req: RequestInfo,
  vaultSource: VaultSource = getVault,
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
  const vault = resolveVault(vaultSource);
  const { max, windowMs } = RATE_LIMITS.registerPerIp;
  if (limitsAddress(req.ip) && (await hitRateLimit(db, ipKey(vault, "register", req.ip), windowMs, req.now)) > max) {
    return { ok: false, reason: "rate-limited", message: RATE_LIMITED };
  }

  const row = newUserRow(vault, username.value, await hashPassword(password.value));
  const user: PublicUser = { id: row.id, username: username.value };
  if (!(await insertUser(db, row))) return { ok: false, reason: "taken", errors: { username: "That username is taken." } };
  return startSession(db, vault, user, req.now);
}

export async function login(
  source: DbSource,
  input: { username: unknown; password: unknown },
  req: RequestInfo,
  vaultSource: VaultSource = getVault,
): Promise<AuthResult> {
  // Just require something in both fields; "invalid" is only for empty ones
  // (and a username no account could have, below).
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
  // the same since accounts started), so it's refused without the database,
  // with what's wrong with it (#133): people type their full name or an
  // email, and since no username has one, saying so reveals nothing. This
  // also keeps very long input out of the rate-limit table, where a key over
  // Postgres's index limit was an error.
  const hint = loginUsernameHint(username);
  if (hint !== null) return { ok: false, reason: "invalid", errors: { username: hint } };

  const db = resolve(source);
  const vault = resolveVault(vaultSource);
  // Count the attempt before checking the password, so a blocked client learns
  // nothing about whether its guess was right. The address first: a client
  // that's over its own limit stops here, without adding to the username's
  // count, so it can't keep locking someone else's account.
  if (limitsAddress(req.ip)) {
    const ipHits = await hitRateLimit(db, ipKey(vault, "login", req.ip), RATE_LIMITS.loginPerIp.windowMs, req.now);
    if (ipHits > RATE_LIMITS.loginPerIp.max) return { ok: false, reason: "rate-limited", message: RATE_LIMITED };
  }
  // Then the username's count, or this browser's own if it has logged into
  // this username before (#151), so a stranger's guesses can't lock it out.
  const trusted = isDeviceTokenFor(vault, username, req.device, req.now);
  const limitKey = trusted ? loginDeviceKey(vault, req.device as string) : loginUserKey(vault, username);
  const limit = trusted ? RATE_LIMITS.loginPerDevice : RATE_LIMITS.loginPerUser;
  if ((await hitRateLimit(db, limitKey, limit.windowMs, req.now)) > limit.max) {
    return { ok: false, reason: "rate-limited", message: RATE_LIMITED };
  }

  const row = await findLoginRow(db, usernameIndex(vault, username));
  // Unknown username: still run one hash, so timing doesn't reveal which usernames exist.
  const matches = await verifyPassword(password.slice(0, 1024), row?.passwordHash ?? (await getDummyPasswordHash()));
  if (!row || !matches) return { ok: false, reason: "wrong-credentials", message: WRONG_CREDENTIALS };

  // Decrypt before clearing the limit: if the key is wrong, the attempt still counts.
  const user = toPublicUser(vault, row);
  // Clear only the count this attempt was made against. A trusted login
  // mustn't clear the username's: while someone else is guessing, that would
  // hand them a fresh set of attempts every time the owner logs in.
  await clearRateLimit(db, limitKey);
  return startSession(db, vault, user, req.now, trusted ? (req.device as string) : undefined);
}
