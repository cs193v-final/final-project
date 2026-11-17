// Username and password rules for accounts (#53). Pure and framework-free, so
// the forms, the server and the test-user script all apply the same rules.
//
// Usernames are what other players may see (e.g. leaderboards, #62), so they
// can't be email addresses: we don't collect emails at all.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Long passphrases are welcome; the cap only stops absurd inputs from costing hashing time. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Letters, digits, `_` and `-`. No spaces, no `@`, no `.`. */
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const ALLOWED_CHAR = /^[A-Za-z0-9_-]$/;

/**
 * Whitespace, plus the invisible separators that survive NFKC and `trim()`
 * (zero-width space, joiners, word joiner, Mongolian vowel separator, BOM).
 * A name pasted with one looks fine, so it gets the "spaces" message rather
 * than an error about a character nobody can see.
 */
const SPACE_LIKE = /[\s\u200B-\u200D\u2060\u180E\uFEFF]/u;

/** Whether a typed username has a space (or an invisible one) in it. */
export function hasSpaces(value: string): boolean {
  return SPACE_LIKE.test(value);
}

export type RuleResult = { ok: true; value: string } | { ok: false; error: string };

/** "spaces", "spaces or “'”", "spaces, “'” or “é”". */
function listDisallowed(value: string): string | null {
  const found: string[] = [];
  let spaces = false;
  let invisible = false;
  for (const char of value) {
    if (ALLOWED_CHAR.test(char)) continue;
    if (SPACE_LIKE.test(char)) spaces = true;
    else if (/[\p{Cc}\p{Cf}\p{M}]/u.test(char)) invisible = true;
    else if (found.length <= 5 && !found.includes(char)) found.push(char); // enough to name; the rest are "other symbols"
  }
  const names = [
    ...(spaces ? ["spaces"] : []),
    ...found.slice(0, 5).map((char) => `“${char}”`),
    ...(found.length > 5 ? ["other symbols"] : []),
    ...(invisible ? ["invisible characters"] : []),
  ];
  if (names.length === 0) return null;
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/**
 * Checks a username and returns it trimmed. Case is kept for display;
 * uniqueness ignores case: the database's unique `username_index` is a keyed
 * hash of `usernameKey(username)` (see ./user-row.ts).
 *
 * A rejected name gets one message that lists everything wrong with it, so
 * fixing what it says doesn't lead to a second rejection (#133): "Jane
 * O'Brien" hears about the space and the apostrophe at once, and a long full
 * name also hears that it's too long once the spaces are gone.
 */
export function checkUsername(raw: unknown): RuleResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a username." };
  const value = raw.normalize("NFKC").trim();
  if (value === "") return { ok: false, error: "Enter a username." };
  if (value.includes("@")) {
    return { ok: false, error: "Pick a username, not an email address. We don't store emails." };
  }
  const lengthRule = `Usernames are ${USERNAME_MIN} to ${USERNAME_MAX} characters long.`;
  if (USERNAME_PATTERN.test(value)) {
    return value.length < USERNAME_MIN || value.length > USERNAME_MAX ? { ok: false, error: lengthRule } : { ok: true, value };
  }
  // The most common mistake in user testing (#133) is typing a full name.
  const disallowed = listDisallowed(value);
  const spacesOnly = disallowed === "spaces";
  const advice = spacesOnly
    ? "Try joining the words, or use _ or - between them."
    : `Use only letters a–z, numbers, _ and -${hasSpaces(value) ? " (_ or - can go between words)" : ""}.`;
  // Say now if the fixed name would still be the wrong length: too long even
  // with everything not allowed removed, or too short even with each one
  // replaced by _ or -.
  const chars = [...value];
  const kept = chars.filter((char) => ALLOWED_CHAR.test(char)).length;
  const length = kept > USERNAME_MAX || chars.length < USERNAME_MIN ? ` ${lengthRule}` : "";
  return { ok: false, error: `Usernames can't contain ${disallowed ?? "those characters"}. ${advice}${length}` };
}

/** Checks a new password. The password itself is never trimmed or changed. */
export function checkNewPassword(raw: unknown): RuleResult {
  if (typeof raw !== "string" || raw === "") return { ok: false, error: "Enter a password." };
  // Count characters (code points), not UTF-16 units.
  const length = [...raw].length;
  if (length < PASSWORD_MIN) {
    return { ok: false, error: `Passwords need at least ${PASSWORD_MIN} characters.` };
  }
  if (length > PASSWORD_MAX) {
    return { ok: false, error: `Passwords can be at most ${PASSWORD_MAX} characters.` };
  }
  return { ok: true, value: raw };
}

/**
 * The key that makes usernames unique, ignoring case. The database stores only
 * a keyed hash of it (`username_index`, #84), which login looks up and which
 * keeps usernames unique. Changing this function silently breaks login and
 * uniqueness for every existing user, since their stored hashes were made from
 * the old output; it would need a migration that recomputes every index.
 */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}
