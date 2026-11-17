import { describe, expect, it } from "vitest";

import { checkNewPassword, checkUsername, PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, usernameKey } from "./rules";

describe("checkUsername", () => {
  it.each(["ethan", "Ethan_Y", "a-b", "abc", "x".repeat(USERNAME_MAX)])("accepts %s", (name) => {
    expect(checkUsername(name)).toEqual({ ok: true, value: name });
  });

  it("trims surrounding spaces and keeps the case", () => {
    expect(checkUsername("  Ethan ")).toEqual({ ok: true, value: "Ethan" });
  });

  it.each(["ethan@stanford.edu", "me@x", "@ethan"])("rejects the email-like %s with an email message", (name) => {
    const result = checkUsername(name);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/not an email/i);
  });

  it.each([
    ["too short", "ab"],
    ["too long", "x".repeat(USERNAME_MAX + 1)],
    ["a space", "ethan y"],
    ["a dot", "ethan.y"],
    ["an accent", "café"],
    ["an emoji", "ethan🙂"],
  ])("rejects a username with %s", (_why, name) => {
    expect(checkUsername(name).ok).toBe(false);
  });

  it("says what's wrong when a username has a space, e.g. a full name (#133)", () => {
    for (const name of ["Jane Doe", "jane\tdoe", "a b"]) {
      const result = checkUsername(name);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatch(/can't contain spaces/);
    }
  });

  it.each([undefined, null, 42, "", "   "])("rejects a missing username (%s)", (raw) => {
    expect(checkUsername(raw)).toEqual({ ok: false, error: "Enter a username." });
  });

  it("folds full-width letters to plain ones before checking", () => {
    expect(checkUsername("ｅｔｈａｎ")).toEqual({ ok: true, value: "ethan" });
  });
});

describe("checkNewPassword", () => {
  it("accepts a password of the minimum length, unchanged", () => {
    const pw = " ".repeat(2) + "x".repeat(PASSWORD_MIN - 2);
    expect(checkNewPassword(pw)).toEqual({ ok: true, value: pw });
  });

  it("rejects short, missing and overly long passwords", () => {
    expect(checkNewPassword("x".repeat(PASSWORD_MIN - 1)).ok).toBe(false);
    expect(checkNewPassword("").ok).toBe(false);
    expect(checkNewPassword(undefined).ok).toBe(false);
    expect(checkNewPassword("x".repeat(PASSWORD_MAX + 1)).ok).toBe(false);
  });

  it("counts characters, not UTF-16 units", () => {
    // 8 emoji are 16 UTF-16 units but 8 characters: allowed.
    expect(checkNewPassword("🙂".repeat(PASSWORD_MIN)).ok).toBe(true);
    expect(checkNewPassword("🙂".repeat(PASSWORD_MAX)).ok).toBe(true);
  });
});

describe("usernameKey", () => {
  it("ignores case, like the database's lower(username) index", () => {
    expect(usernameKey("EthanY")).toBe(usernameKey("ethany"));
  });
});
