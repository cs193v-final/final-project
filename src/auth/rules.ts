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

/** The characters a username may have: letters a–z, digits, `_` and `-`. One source for both patterns below. */
const ALLOWED = "A-Za-z0-9_-";
const USERNAME_PATTERN = new RegExp(`^[${ALLOWED}]+$`);
const ALLOWED_CHAR = new RegExp(`[${ALLOWED}]`, "g");

/**
 * Whitespace (`\s` includes the BOM), plus the invisible separators that
 * survive NFKC and `trim()`: zero-width space, word joiner and Mongolian vowel
 * separator. A name pasted with one looks fine, so it gets the "spaces"
 * message rather than an error about a character nobody can see. The joiners
 * ZWJ and ZWNJ are not here: they belong to the character next to them (emoji
 * sequences, Persian, Indic scripts), and graphemes keep them together.
 */
const SPACE_LIKE = /^[\s\u200B\u2060\u180E]+$/u;
/** Control and format characters: nothing a person can see. */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/**
 * Past this, a name is too long however it's fixed, so it's refused before
 * any per-character work: login and sign-up get the whole field (a Server
 * Action accepts about 1 MB).
 */
const QUICK_MAX = USERNAME_MAX * 4;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export type RuleResult = { ok: true; value: string } | { ok: false; error: string };

/** What's wrong with a username, if anything: worded by `checkUsername` (sign-up) and `loginUsernameHint` (login). */
type UsernameProblem =
  | { kind: "ok"; value: string }
  | { kind: "empty" }
  | { kind: "email" }
  | { kind: "length" }
  | {
      kind: "characters";
      /** Spaces or invisible separators. */
      spaces: boolean;
      /** Up to 5 characters that aren't allowed, each as people see it (a whole grapheme: “❤️”, “रा”). */
      found: string[];
      /** More than 5 different ones. */
      more: boolean;
      /** Characters nobody can see (controls, format characters). */
      invisible: boolean;
      /** Whether removing what isn't allowed, or replacing each with `_`, could still give the wrong length. */
      lengthToo: boolean;
    };

function analyzeUsername(raw: unknown): UsernameProblem {
  if (typeof raw !== "string") return { kind: "empty" };
  if (raw.trim().length > QUICK_MAX) return { kind: "length" };
  const value = raw.normalize("NFKC").trim();
  if (value === "") return { kind: "empty" };
  if (value.includes("@")) return { kind: "email" };
  if (USERNAME_PATTERN.test(value)) {
    return value.length < USERNAME_MIN || value.length > USERNAME_MAX ? { kind: "length" } : { kind: "ok", value };
  }

  let spaces = false;
  let invisible = false;
  const found: string[] = [];
  let more = false;
  // The length after each fix the message suggests: removing what isn't
  // allowed (joining the words), or replacing each visible one with _ or -.
  let removed = 0;
  let replaced = 0;
  for (const { segment } of graphemes.segment(value)) {
    const allowedCount = segment.match(ALLOWED_CHAR)?.length ?? 0;
    const visible = segment.replace(INVISIBLE, "");
    if (visible.length > 0 && allowedCount === visible.length) {
      // Allowed characters, perhaps with an invisible one stuck to them (a ZWJ between two letters).
      if (visible !== segment) invisible = true;
      removed += allowedCount;
      replaced += allowedCount;
    } else if (SPACE_LIKE.test(segment)) {
      spaces = true;
      replaced += 1;
    } else if (visible === "") {
      invisible = true;
    } else {
      replaced += 1;
      if (found.includes(segment)) continue;
      if (found.length < 5) found.push(segment);
      else more = true;
    }
  }
  const outOfRange = (n: number) => n < USERNAME_MIN || n > USERNAME_MAX;
  return { kind: "characters", spaces, found, more, invisible, lengthToo: outOfRange(removed) || outOfRange(replaced) };
}

const LENGTH_RULE = `Usernames are ${USERNAME_MIN} to ${USERNAME_MAX} characters long.`;

/** "spaces", "spaces or “'”", "spaces, “'” or “é”". */
function listCharacters(problem: Extract<UsernameProblem, { kind: "characters" }>): string {
  const names = [
    ...(problem.spaces ? ["spaces"] : []),
    ...problem.found.map((char) => `“${char}”`),
    ...(problem.more ? ["other symbols"] : []),
    ...(problem.invisible ? ["invisible characters"] : []),
  ];
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

/**
 * Checks a username and returns it trimmed. Case is kept for display;
 * uniqueness ignores case: the database's unique `username_index` is a keyed
 * hash of `usernameKey(username)` (see ./user-row.ts).
 *
 * A rejected name gets one message that lists everything wrong with it, so
 * fixing what it says doesn't lead to a second rejection (#133): "Jane
 * O'Brien" hears about the space and the apostrophe at once, and a name that
 * would be too short or too long after following the advice hears that too.
 */
export function checkUsername(raw: unknown): RuleResult {
  const problem = analyzeUsername(raw);
  switch (problem.kind) {
    case "ok":
      return { ok: true, value: problem.value };
    case "empty":
      return { ok: false, error: "Enter a username." };
    case "email":
      return { ok: false, error: "Pick a username, not an email address. We don't store emails." };
    case "length":
      return { ok: false, error: LENGTH_RULE };
    case "characters": {
      // The most common mistake in user testing (#133) is typing a full name.
      const spacesOnly = problem.spaces && problem.found.length === 0 && !problem.more && !problem.invisible;
      const advice = spacesOnly
        ? "Try joining the words, or use _ or - between them."
        : `Use only letters a–z, numbers, _ and -${problem.spaces ? " (_ or - can go between words)" : ""}.`;
      const length = problem.lengthToo ? ` ${LENGTH_RULE}` : "";
      return { ok: false, error: `Usernames can't contain ${listCharacters(problem)}. ${advice}${length}` };
    }
  }
}

/**
 * For login: what's wrong with a typed username that no account can have, or
 * `null` if it could be someone's (#133). The rules haven't changed since
 * accounts started, so saying why reveals nothing about which accounts exist,
 * and "Jane Doe" or "jose.garcia" learns why, instead of "don't match".
 */
export function loginUsernameHint(raw: unknown): string | null {
  const problem = analyzeUsername(raw);
  const check = "Check the username you signed up with.";
  switch (problem.kind) {
    case "ok":
      return null;
    case "empty":
      return "Enter your username.";
    case "email":
      return `Usernames aren't email addresses. ${check}`;
    case "length":
      return `${LENGTH_RULE} ${check}`;
    case "characters":
      return `Usernames don't have ${listCharacters(problem)}. ${check}`;
  }
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
