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

export type RuleResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Checks a username and returns it trimmed. Case is kept for display;
 * uniqueness ignores case: the database's unique `username_index` is a keyed
 * hash of `usernameKey(username)` (see ./user-row.ts).
 */
export function checkUsername(raw: unknown): RuleResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a username." };
  const value = raw.normalize("NFKC").trim();
  if (value === "") return { ok: false, error: "Enter a username." };
  if (value.includes("@")) {
    return { ok: false, error: "Pick a username, not an email address. We don't store emails." };
  }
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return { ok: false, error: `Usernames are ${USERNAME_MIN} to ${USERNAME_MAX} characters long.` };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return { ok: false, error: "Usernames can use letters, numbers, _ and - only." };
  }
  return { ok: true, value };
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
