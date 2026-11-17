// Application-level encryption for user data (#84). Node's built-in crypto
// only. Server-side code; like src/auth/crypto.ts it has no "server-only"
// import, so scripts can run it with plain Node, and relative imports keep `.ts`.
//
// One master key per tier (dev, preview, production) in DATA_ENCRYPTION_KEY:
// 32 random bytes, base64. Never in the repo; see SECRETS.md (#87).
//
// From the master key, HKDF-SHA256 derives a separate key for every
// (user, field) pair, and a separate key for every keyed-hash purpose:
//
// - `encrypt(userId, field, text)`: AES-256-GCM with a fresh 12-byte nonce and
//   the user's key for that field. The user id and field name are also bound
//   in as associated data, so a value copied to another user's row or another
//   column fails to decrypt instead of being read as theirs. Stored as
//   `v1.<nonce>.<ciphertext+tag>` (base64url), so the format can change later.
// - `blindIndex(purpose, value)`: HMAC-SHA256, hex. For values we must look up
//   or keep unique without storing them (usernames, rate-limit keys, IPs).
//   Unlike a plain SHA-256, it can't be reversed by hashing every candidate
//   (e.g. all 4 billion IPv4 addresses) without the key.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export const ENCRYPTION_KEY_ENV = "DATA_ENCRYPTION_KEY";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";
// Fixed HKDF salt: domain separation for this app and format version.
const HKDF_SALT = Buffer.from("zoom-out/user-data/v1", "utf8");

/** A stored value that isn't ours, was changed, or belongs to another user or field. Never includes key material. */
export class DecryptionError extends Error {
  constructor(message = "Couldn't decrypt a stored value: it's malformed, was changed, or belongs to another user or field.") {
    super(message);
    this.name = "DecryptionError";
  }
}

/** DATA_ENCRYPTION_KEY is missing or isn't 32 bytes of base64. The message never includes the value. */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Field and purpose names: short, fixed identifiers like "users.username". */
const NAME = /^[a-z][a-z0-9_.-]{0,63}$/;
function checkName(kind: string, name: string): void {
  if (!NAME.test(name)) throw new Error(`Vault: invalid ${kind} name`);
}

export class Vault {
  readonly #master: Buffer;
  readonly #keys = new Map<string, Buffer>();

  constructor(masterKey: Buffer) {
    if (masterKey.length !== KEY_BYTES) {
      throw new EncryptionKeyError(`${ENCRYPTION_KEY_ENV} must be ${KEY_BYTES} bytes (base64).`);
    }
    this.#master = Buffer.from(masterKey); // our own copy
  }

  /** Reads the master key from `DATA_ENCRYPTION_KEY` (base64 of 32 bytes). */
  static fromEnv(env: Record<string, string | undefined> = process.env): Vault {
    const raw = env[ENCRYPTION_KEY_ENV]?.trim();
    if (!raw) {
      throw new EncryptionKeyError(
        `${ENCRYPTION_KEY_ENV} is not set. For dev, add one to .env.local (see .env.example); preview and production keys live only in Vercel.`,
      );
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      throw new EncryptionKeyError(`${ENCRYPTION_KEY_ENV} must be base64 (e.g. from \`openssl rand -base64 32\`).`);
    }
    return new Vault(Buffer.from(raw, "base64"));
  }

  #key(info: string): Buffer {
    let key = this.#keys.get(info);
    if (!key) {
      key = Buffer.from(hkdfSync("sha256", this.#master, HKDF_SALT, info, KEY_BYTES));
      this.#keys.set(info, key);
    }
    return key;
  }

  #aad(userId: string, field: string): Buffer {
    return Buffer.from(`${VERSION}\0${field}\0${userId}`, "utf8");
  }

  /** Encrypts `plaintext` for one user and one field. A new random nonce every time, so equal values look different. */
  encrypt(userId: string, field: string, plaintext: string): string {
    checkName("field", field);
    if (userId === "") throw new Error("Vault: userId is required");
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key(`enc\0${field}\0${userId}`), nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(this.#aad(userId, field));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
    return `${VERSION}.${b64url(nonce)}.${b64url(body)}`;
  }

  /** Decrypts a value from `encrypt` with the same user and field. Throws `DecryptionError` otherwise. */
  decrypt(userId: string, field: string, stored: string): string {
    checkName("field", field);
    const parts = stored.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) throw new DecryptionError();
    const nonce = Buffer.from(parts[1]!, "base64url");
    const body = Buffer.from(parts[2]!, "base64url");
    if (nonce.length !== NONCE_BYTES || body.length < TAG_BYTES) throw new DecryptionError();
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key(`enc\0${field}\0${userId}`), nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(this.#aad(userId, field));
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
    } catch {
      throw new DecryptionError();
    }
  }

  /** `encrypt` for any JSON value (e.g. a game's state, #77). */
  encryptJson(userId: string, field: string, value: unknown): string {
    return this.encrypt(userId, field, JSON.stringify(value));
  }

  decryptJson<T>(userId: string, field: string, stored: string): T {
    return JSON.parse(this.decrypt(userId, field, stored)) as T;
  }

  /**
   * A keyed hash of `value` (HMAC-SHA256, hex) for lookups and uniqueness.
   * Each purpose has its own key, so the same value gives unrelated hashes
   * in different places. Normalize `value` first (e.g. lowercase a username).
   */
  blindIndex(purpose: string, value: string): string {
    checkName("purpose", purpose);
    return createHmac("sha256", this.#key(`idx\0${purpose}`)).update(value, "utf8").digest("hex");
  }
}

let cached: Vault | undefined;

/** The app's vault, from `DATA_ENCRYPTION_KEY`, created on first use (like `getDb()`). */
export function getVault(): Vault {
  cached ??= Vault.fromEnv();
  return cached;
}

/** A vault, or a function that returns one, so input can be validated before the key is needed. */
export type VaultSource = Vault | (() => Vault);
export const resolveVault = (source: VaultSource): Vault => (typeof source === "function" ? source() : source);
