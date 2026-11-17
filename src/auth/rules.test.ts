import { describe, expect, it } from "vitest";

import {
  checkNewPassword,
  checkUsername,
  hasSpaces,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  usernameKey,
} from "./rules";

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
    ["a dot", "ethan.y"],
    ["an accent", "café"],
    ["an emoji", "ethan🙂"],
  ])("rejects a username with %s", (_why, name) => {
    expect(checkUsername(name).ok).toBe(false);
  });

  it.each(["ab", "x".repeat(USERNAME_MAX + 1)])("gives the length rule for %s", (name) => {
    expect(checkUsername(name)).toEqual({ ok: false, error: `Usernames are 3 to ${USERNAME_MAX} characters long.` });
  });

  // A full name was the most common mistake in user testing (#133).
  it.each([
    ["a space", "Jane Doe"],
    ["a tab", "jane\tdoe"],
    ["a short name with a space", "a b"],
    ["a zero-width space", "Jane\u200BDoe"],
    ["a zero-width joiner", "Jane\u200DDoe"],
    ["a word joiner", "Jane\u2060Doe"],
    ["a Mongolian vowel separator", "Jane\u180EDoe"],
    ["a byte-order mark inside", "Jane\uFEFFDoe"],
  ])("says to join the words for %s", (_why, name) => {
    expect(checkUsername(name)).toEqual({
      ok: false,
      error: "Usernames can't contain spaces. Try joining the words, or use _ or - between them.",
    });
  });

  // One message with everything wrong, so following it doesn't lead to a second rejection.
  it.each([
    ["Jane O'Brien", "Usernames can't contain spaces or “'”. Use only letters a–z, numbers, _ and - (_ or - can go between words)."],
    ["José García", "Usernames can't contain spaces, “é” or “í”. Use only letters a–z, numbers, _ and - (_ or - can go between words)."],
    ["Jane_O'Brien", "Usernames can't contain “'”. Use only letters a–z, numbers, _ and -."],
    ["ethan.y", "Usernames can't contain “.”. Use only letters a–z, numbers, _ and -."],
    ["café", "Usernames can't contain “é”. Use only letters a–z, numbers, _ and -."],
    [
      "Alexandra Montgomery Smith",
      "Usernames can't contain spaces. Try joining the words, or use _ or - between them. Usernames are 3 to 20 characters long.",
    ],
    ["é", "Usernames can't contain “é”. Use only letters a–z, numbers, _ and -. Usernames are 3 to 20 characters long."],
    [
      "a!b#c$d%e^f&g",
      "Usernames can't contain “!”, “#”, “$”, “%”, “^” or other symbols. Use only letters a–z, numbers, _ and -.",
    ],
    ["ab\u0007cd", "Usernames can't contain invisible characters. Use only letters a–z, numbers, _ and -."],
  ])("lists everything wrong with %j", (name, error) => {
    expect(checkUsername(name)).toEqual({ ok: false, error });
  });

  it.each([
    ["Jane Doe", true],
    ["Jane\u200BDoe", true],
    ["Jane\uFEFFDoe", true],
    ["jane_doe", false],
    ["jane.doe", false],
  ])("hasSpaces(%j) is %s", (name, expected) => {
    expect(hasSpaces(name)).toBe(expected);
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
