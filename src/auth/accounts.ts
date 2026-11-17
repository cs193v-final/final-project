// Register and log in (#53): the rules, hashing and rate limits, given a
// database client. Cookies live in `./session.ts`; this file never touches the
// request, so it's tested directly against PGlite.
//
// Encryption (#84): usernames are stored encrypted with the user's own key,
// and looked up by a keyed hash. Rate-limit keys use keyed hashes too, so the
// database never holds a username or an IP address in a form anyone without
// the key can read or recompute. See src/crypto/vault.ts.
import {
  clearRateLimit,
  deleteSession,
  findLoginRow,
  findSessionUser,
  hitRateLimit,
  insertSession,
  insertUser,
  type PgDb,
  type StoredUser,
} from "@/db/accounts";
import { DecryptionError, getVault, resolveVault, type Vault, type VaultSource } from "@/crypto/vault";
import type { PublicUser } from "@/game/types";

import { getDummyPasswordHash, hashPassword, newToken, sha256Hex, verifyPassword } from "./crypto";
import { limitsAddress } from "./limits-address";
import { checkNewPassword, checkUsername, usernameKey } from "./rules";
import { newUserRow, USERNAME_FIELD, usernameIndex } from "./user-row";

export { USERNAME_FIELD, usernameIndex };

/** Keyed-hash purposes for rate-limit keys, as passed to the vault. Changing one only resets the counters. */
const PURPOSE = { loginUser: "rate-limit.login-user", ip: "rate-limit.ip" } as const;

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

// `limitsAddress` lives in ./limits-address.ts so the game server (#85) can use
// it without loading this module (and its argon2 warm-up).
export { limitsAddress };

/**
 * Keyed hashes (#84), never the typed name or a raw IP: people type emails,
 * or their password, into the username box, and this row is written before
 * we know the user exists.
 */
export const ipKey = (vault: Vault, prefix: string, ip: string | null) =>
  `${prefix}:ip:${ip ? vault.blindIndex(PURPOSE.ip, ip) : "unknown"}`;
export const loginUserKey = (vault: Vault, username: string) =>
  `login:user:${vault.blindIndex(PURPOSE.loginUser, usernameKey(username))}`;

const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";
const WRONG_CREDENTIALS = "That username and password don't match.";

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
  return startSession(db, user, req.now);
}

export async function login(
  source: DbSource,
  input: { username: unknown; password: unknown },
  req: RequestInfo,
  vaultSource: VaultSource = getVault,
): Promise<AuthResult> {
  // Just require something in both fields; "invalid" is only for empty ones.
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
  if (!checkUsername(username).ok) return { ok: false, reason: "wrong-credentials", message: WRONG_CREDENTIALS };

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
  const userHits = await hitRateLimit(db, loginUserKey(vault, username), RATE_LIMITS.loginPerUser.windowMs, req.now);
  if (userHits > RATE_LIMITS.loginPerUser.max) return { ok: false, reason: "rate-limited", message: RATE_LIMITED };

  const row = await findLoginRow(db, usernameIndex(vault, username));
  // Unknown username: still run one hash, so timing doesn't reveal which usernames exist.
  const matches = await verifyPassword(password.slice(0, 1024), row?.passwordHash ?? (await getDummyPasswordHash()));
  if (!row || !matches) return { ok: false, reason: "wrong-credentials", message: WRONG_CREDENTIALS };

  // Decrypt before clearing the limit: if the key is wrong, the attempt still counts.
  const user = toPublicUser(vault, row);
  await clearRateLimit(db, loginUserKey(vault, username));
  return startSession(db, user, req.now);
}
