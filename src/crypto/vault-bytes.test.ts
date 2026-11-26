// Spec for `Vault.encryptBytes` / `decryptBytes` (#67): uploaded lobby photos
// are user data, so they're encrypted like every other user field, as bytes.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DecryptionError, Vault } from "./vault";

const vault = new Vault(Buffer.alloc(32, 7));
const ALICE = "lobby-upload:0123456789abcdef0123456789abcdef";
const BOB = "lobby-upload:fedcba9876543210fedcba9876543210";
const FIELD = "lobby_uploads.bytes";

describe("encryptBytes and decryptBytes", () => {
  const photo = new Uint8Array(randomBytes(5000));

  it("round-trips bytes, including none", () => {
    for (const bytes of [photo, new Uint8Array(0)]) {
      expect(vault.decryptBytes(ALICE, FIELD, vault.encryptBytes(ALICE, FIELD, bytes))).toEqual(bytes);
    }
  });

  it("never stores the plaintext, adds only 29 bytes, and differs each time", () => {
    const text = new TextEncoder().encode("GPS 37.4275 -122.1697 Stanford");
    const a = vault.encryptBytes(ALICE, FIELD, text);
    const b = vault.encryptBytes(ALICE, FIELD, text);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).includes("Stanford")).toBe(false);
    expect(a.byteLength).toBe(text.byteLength + 29);
    expect(a[0]).toBe(1);
  });

  it("another id, another field, a changed byte, a cut-short value or another version fails to decrypt", () => {
    const stored = vault.encryptBytes(ALICE, FIELD, photo);
    expect(() => vault.decryptBytes(BOB, FIELD, stored)).toThrow(DecryptionError);
    expect(() => vault.decryptBytes(ALICE, "image_files.bytes", stored)).toThrow(DecryptionError);
    const changed = new Uint8Array(stored);
    changed[40]! ^= 1;
    expect(() => vault.decryptBytes(ALICE, FIELD, changed)).toThrow(DecryptionError);
    expect(() => vault.decryptBytes(ALICE, FIELD, stored.subarray(0, 20))).toThrow(DecryptionError);
    const otherVersion = new Uint8Array(stored);
    otherVersion[0] = 2;
    expect(() => vault.decryptBytes(ALICE, FIELD, otherVersion)).toThrow(DecryptionError);
  });

  it("text and byte values can't be swapped for each other", () => {
    const text = vault.encrypt(ALICE, FIELD, "hello");
    expect(() => vault.decryptBytes(ALICE, FIELD, new TextEncoder().encode(text))).toThrow(DecryptionError);
  });
});
