// Password hashing and session tokens (#53). Node's built-in crypto only, no
// dependencies. Server-side code; it has no "server-only" import so the
// test-user script can run it with plain Node, and relative imports keep `.ts`.
//
// Passwords: argon2id (node:crypto, Node 24.7+) with the OWASP minimum
// parameters (19 MiB memory, 2 passes, 1 lane) and a random 16-byte salt per
// password. Stored in the standard PHC string format, which records the
// algorithm, parameters and salt, so the parameters can be raised later and
// old hashes still verify.
//
// Sessions: the cookie holds 32 random bytes (base64url). The database holds
// only its SHA-256, so a leaked `sessions` table can't be replayed. A plain
// hash is enough here (unlike passwords) because the token is random and long.
import { argon2, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type Argon2Params = { memoryKiB: number; passes: number; parallelism: number };

export const ARGON2_PARAMS: Argon2Params = { memoryKiB: 19_456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const HASH_BYTES = 32;

function argon2id(password: string, salt: Buffer, params: Argon2Params, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(password, "utf8"),
        nonce: salt,
        parallelism: params.parallelism,
        tagLength: length,
        memory: params.memoryKiB,
        passes: params.passes,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");

/** Hashes a password as `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`. */
export async function hashPassword(password: string, params: Argon2Params = ARGON2_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await argon2id(password, salt, params, HASH_BYTES);
  return `$argon2id$v=19$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/**
 * True if `password` matches `stored`. A malformed `stored` value is a
 * mismatch, never a crash. Compares in constant time.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(stored);
  if (!match) return false;
  const [, m, t, p, saltB64, hashB64] = match;
  const params = { memoryKiB: Number(m), passes: Number(t), parallelism: Number(p) };
  const salt = Buffer.from(saltB64!, "base64");
  const expected = Buffer.from(hashB64!, "base64");
  if (expected.length === 0) return false;
  try {
    const actual = await argon2id(password, salt, params, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * A hash of a password nobody knows, computed once. Login checks against it
 * when the username doesn't exist, so a wrong username takes as long as a
 * wrong password and response times don't reveal which usernames exist.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  // A failure (e.g. argon2 can't get its memory on a cold start) isn't kept:
  // a cached rejection would make every unknown-username login an error while
  // real usernames still got "don't match", which reveals who exists.
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url")).catch((error: unknown) => {
    dummyHash = undefined;
    throw error;
  });
  return dummyHash;
}

/** 32 random bytes as base64url: 43 characters, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A new random token for a cookie: the session cookie here, and the anonymous
 * owner cookie (src/server/owner.ts). Never stored; only its `sha256Hex` is.
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A cookie value shaped like one we issued, rather than garbage or a tampered value. */
export function isToken(value: string | undefined): value is string {
  return value !== undefined && TOKEN_PATTERN.test(value);
}

/** What the database stores for a token, or for any value we key on (IP addresses, typed usernames). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
