import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DecryptionError, EncryptionKeyError, Vault } from "./vault";

const KEY = Buffer.alloc(32, 7);
const vault = new Vault(KEY);
const ALICE = "6f1c1f3e-8f53-4a59-9d4e-0d6e2b0c1a11";
const BOB = "0b9f6d0a-2a6f-4a3c-bc1e-93b1f2d4e622";

/** Flips one bit in the ciphertext part of a stored value. */
function tamper(stored: string): string {
  const [v, nonce, body] = stored.split(".");
  const bytes = Buffer.from(body!, "base64url");
  bytes[0]! ^= 1;
  return `${v}.${nonce}.${bytes.toString("base64url")}`;
}

describe("encrypt and decrypt", () => {
  it("round-trips text, including non-ASCII", () => {
    for (const text of ["Ethan", "", "ünïcødé ✓ 🦒", "x".repeat(10_000)]) {
      expect(vault.decrypt(ALICE, "users.username", vault.encrypt(ALICE, "users.username", text))).toBe(text);
    }
  });

  it("round-trips JSON", () => {
    const state = { guesses: ["giraffe", "zebra"], level: 2, done: false };
    expect(vault.decryptJson(ALICE, "games.state", vault.encryptJson(ALICE, "games.state", state))).toEqual(state);
  });

  it("never stores the plaintext, and the same value encrypts differently each time", () => {
    const a = vault.encrypt(ALICE, "users.username", "Ethan");
    const b = vault.encrypt(ALICE, "users.username", "Ethan");
    expect(a).not.toBe(b);
    expect(a).not.toContain("Ethan");
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  });

  it("another user's key can't decrypt it", () => {
    const stored = vault.encrypt(ALICE, "users.username", "Ethan");
    expect(() => vault.decrypt(BOB, "users.username", stored)).toThrow(DecryptionError);
  });

  it("another field's key can't decrypt it", () => {
    const stored = vault.encrypt(ALICE, "users.username", "Ethan");
    expect(() => vault.decrypt(ALICE, "games.state", stored)).toThrow(DecryptionError);
  });

  it("another master key (another tier) can't decrypt it", () => {
    const stored = vault.encrypt(ALICE, "users.username", "Ethan");
    expect(() => new Vault(randomBytes(32)).decrypt(ALICE, "users.username", stored)).toThrow(DecryptionError);
  });

  it("rejects tampered or malformed values", () => {
    const stored = vault.encrypt(ALICE, "users.username", "Ethan");
    for (const bad of [tamper(stored), stored.replace(/^v1/, "v2"), "Ethan", "", "v1..", `v1.${"A".repeat(16)}.AAAA`]) {
      expect(() => vault.decrypt(ALICE, "users.username", bad)).toThrow(DecryptionError);
    }
  });

  it("refuses odd field names and an empty user id", () => {
    expect(() => vault.encrypt(ALICE, "Users Username", "x")).toThrow();
    expect(() => vault.encrypt("", "users.username", "x")).toThrow();
  });
});

describe("blindIndex", () => {
  it("is stable for a value, so it can be looked up", () => {
    expect(vault.blindIndex("users.username", "ethan")).toBe(vault.blindIndex("users.username", "ethan"));
    expect(vault.blindIndex("users.username", "ethan")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs by value, by purpose and by master key", () => {
    const h = vault.blindIndex("users.username", "ethan");
    expect(vault.blindIndex("users.username", "ethan2")).not.toBe(h);
    expect(vault.blindIndex("rate-limit.user", "ethan")).not.toBe(h);
    expect(new Vault(randomBytes(32)).blindIndex("users.username", "ethan")).not.toBe(h);
  });

  it("isn't a plain SHA-256 that anyone could recompute", async () => {
    const { createHash } = await import("node:crypto");
    expect(vault.blindIndex("rate-limit.ip", "203.0.113.7")).not.toBe(
      createHash("sha256").update("203.0.113.7").digest("hex"),
    );
  });
});

describe("the master key", () => {
  const good = randomBytes(32).toString("base64");

  it("comes from DATA_ENCRYPTION_KEY", () => {
    const a = Vault.fromEnv({ DATA_ENCRYPTION_KEY: good });
    const b = Vault.fromEnv({ DATA_ENCRYPTION_KEY: ` ${good}\n` });
    expect(b.decrypt(ALICE, "users.username", a.encrypt(ALICE, "users.username", "Ethan"))).toBe("Ethan");
  });

  it("must be set, base64, and 32 bytes, and errors never echo it", () => {
    const short = randomBytes(16).toString("base64");
    for (const env of [{}, { DATA_ENCRYPTION_KEY: "" }, { DATA_ENCRYPTION_KEY: "not base64!" }, { DATA_ENCRYPTION_KEY: short }]) {
      let error: unknown;
      try {
        Vault.fromEnv(env);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(EncryptionKeyError);
      const value = Object.values(env)[0];
      if (value) expect((error as Error).message).not.toContain(value);
    }
  });
});
