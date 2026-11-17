import { describe, expect, it } from "vitest";

import { getDummyPasswordHash, hashPassword, isToken, newToken, sha256Hex, verifyPassword } from "./crypto";

describe("hashPassword / verifyPassword", () => {
  it("stores an argon2id PHC string, never the password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(hash).not.toContain("correct horse battery");
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("verifies with the parameters stored in the hash", async () => {
    const hash = await hashPassword("pw-123456", { memoryKiB: 8192, passes: 1, parallelism: 1 });
    expect(hash).toContain("m=8192,t=1,p=1");
    expect(await verifyPassword("pw-123456", hash)).toBe(true);
  });

  it.each(["", "plaintext", "$2b$10$bcryptlooking", "$argon2id$v=19$m=x,t=2,p=1$abc$def"])(
    "treats a malformed stored value (%s) as a mismatch",
    async (stored) => {
      expect(await verifyPassword("anything", stored)).toBe(false);
    },
  );

  it("has a dummy hash that nothing matches, computed once", async () => {
    const a = await getDummyPasswordHash();
    expect(a).toBe(await getDummyPasswordHash());
    expect(await verifyPassword("", a)).toBe(false);
  });
});

describe("session tokens", () => {
  it("are random 32-byte base64url strings", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });

  it("are recognised by shape, so a garbage cookie never reaches the database", () => {
    expect(isToken(newToken())).toBe(true);
    for (const bad of [undefined, "", "not-a-real-session", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`]) {
      expect(isToken(bad), String(bad)).toBe(false);
    }
  });

  it("are stored as a SHA-256 hex digest", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
