// Custom lobbies (#67): the rules that don't need a database. Owner: Jacky.
// Framework-free, so it's unit-testable and the create-a-round screen (#68)
// can share the limits and result types. Never put an answer or a code index
// in anything sent to a client except where a function here says so.
//
// A lobby is a share-a-code round of 3-5 photos a logged-in player uploaded.
// It plays as a pack of kind "lobby" through the same server game as practice
// and the daily (#54), so the answers stay on the server.

// Web Crypto's `crypto.getRandomValues` (a CSPRNG in Node and browsers), not
// `node:crypto`, so #68's client components can import the limits from here.
import { normalizeGuess } from "./guess.ts";

// ---------------------------------------------------------------------------
// Limits. Every value is open for the team (see the PR for #67).
// ---------------------------------------------------------------------------

/** Photos per lobby (the brief: 3-5). */
export const MIN_LOBBY_PUZZLES = 3;
export const MAX_LOBBY_PUZZLES = 5;

/** A lobby can be played for 30 days after it's made, then the sweep deletes it. */
export const LOBBY_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Distinct reports that hide a lobby (from everyone but its owner) until someone reviews it. */
export const REPORTS_TO_HIDE = 3;

/** Same zoom steps as the practice and daily puzzles (#117): 14× on a detail first. */
export const LOBBY_ZOOM_LEVELS: readonly number[] = [14, 8, 4.5, 2.5, 1];

/** Longest answer or alternate, in characters (after trimming). */
export const MAX_ANSWER_LENGTH = 60;

/** Most alternate answers per photo. */
export const MAX_ALTERNATES = 8;

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * Crockford's base32: digits and capitals without I, L, O and U, so a code
 * read aloud or copied by hand can't be mistaken (I/L look like 1, O like 0).
 */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 16 characters of 5 bits: 80 random bits, so guessing a live code is hopeless even without the rate limits. */
export const CODE_LENGTH = 16;
export const CODE_BITS = CODE_LENGTH * 5;

/** A new lobby code from the OS's CSPRNG, as 16 characters (no separators). */
export function newLobbyCode(random: (bytes: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(CODE_BITS / 8);
  let bits = 0;
  let value = 0;
  let code = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      code += CODE_ALPHABET[(value >> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  return code;
}

/** How a code is shown and shared: four groups of four, e.g. `7KQ2-M9XD-...`. */
export function formatLobbyCode(code: string): string {
  return code.match(/.{1,4}/gu)?.join("-") ?? code;
}

/**
 * A code as typed (any case, spaces or dashes, O for 0, I or L for 1) in
 * its stored form, or `null` if it can't be a code. Untrusted input.
 */
export function normalizeLobbyCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const code = input
    .toUpperCase()
    .replace(/[\s-]/gu, "")
    .replace(/O/gu, "0")
    .replace(/[IL]/gu, "1");
  if (code.length !== CODE_LENGTH) return null;
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return null;
  return code;
}

// ---------------------------------------------------------------------------
// What a client sends to create a lobby
// ---------------------------------------------------------------------------

/** An upload's id (`lobby_uploads.id`): 32 hex characters, 128 random bits. */
export const UPLOAD_ID = /^[0-9a-f]{32}$/u;

/** One photo of a new lobby, as #68's screen sends it. */
export type LobbyRoundInput = {
  /** From the upload endpoint (`POST /api/lobby-uploads`). */
  uploadId: string;
  answer: string;
  acceptedAnswers: string[];
  /** Where the first, tightest zoom is centred: 0-1 fractions of width and height. */
  focus: { x: number; y: number };
};

export class InvalidLobbyError extends Error {
  constructor(readonly reason: string) {
    super(`invalid lobby: ${reason}`);
    this.name = "InvalidLobbyError";
  }
}

function answerText(value: unknown, what: string): string {
  if (typeof value !== "string") throw new InvalidLobbyError(`${what} must be text`);
  const text = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (text.length > MAX_ANSWER_LENGTH) throw new InvalidLobbyError(`${what} is over ${MAX_ANSWER_LENGTH} characters`);
  // Something a guess could match: only punctuation normalizes to "", which
  // is an empty guess (guess.ts), so it could never be answered.
  if (normalizeGuess(text) === "") throw new InvalidLobbyError(`${what} is empty`);
  return text;
}

function fraction(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InvalidLobbyError("the focus point must be inside the photo");
  }
  return value;
}

/**
 * Checks what a client sent to create a lobby (untrusted): 3-5 photos, each
 * a distinct upload id, an answer, up to `MAX_ALTERNATES` alternates and a
 * focus point. Trims answers; drops alternates that normalize to the answer
 * or to each other. Throws `InvalidLobbyError` (never echoing the input).
 */
export function parseLobbyRounds(value: unknown): LobbyRoundInput[] {
  if (!Array.isArray(value)) throw new InvalidLobbyError("rounds must be a list");
  if (value.length < MIN_LOBBY_PUZZLES || value.length > MAX_LOBBY_PUZZLES) {
    throw new InvalidLobbyError(`a lobby has ${MIN_LOBBY_PUZZLES}-${MAX_LOBBY_PUZZLES} photos`);
  }
  const uploads = new Set<string>();
  return value.map((raw: unknown, i) => {
    if (typeof raw !== "object" || raw === null) throw new InvalidLobbyError(`photo ${i + 1} is malformed`);
    const r = raw as Record<string, unknown>;
    if (typeof r.uploadId !== "string" || !UPLOAD_ID.test(r.uploadId)) throw new InvalidLobbyError(`photo ${i + 1} has no upload`);
    if (uploads.has(r.uploadId)) throw new InvalidLobbyError("the same upload is used twice");
    uploads.add(r.uploadId);
    const answer = answerText(r.answer, "an answer");
    const alternates = r.acceptedAnswers ?? [];
    if (!Array.isArray(alternates) || alternates.length > MAX_ALTERNATES) {
      throw new InvalidLobbyError(`at most ${MAX_ALTERNATES} alternate answers per photo`);
    }
    const seen = new Set([normalizeGuess(answer)]);
    const acceptedAnswers: string[] = [];
    for (const alt of alternates) {
      const text = answerText(alt, "an alternate answer");
      const key = normalizeGuess(text);
      if (seen.has(key)) continue;
      seen.add(key);
      acceptedAnswers.push(text);
    }
    const focus = r.focus as Record<string, unknown> | null | undefined;
    if (typeof focus !== "object" || focus === null) throw new InvalidLobbyError("the focus point must be inside the photo");
    return { uploadId: r.uploadId, answer, acceptedAnswers, focus: { x: fraction(focus.x), y: fraction(focus.y) } };
  });
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** The state columns of a `lobbies` row that decide whether it can be played. */
export type LobbyStatus = {
  ownerUserId: string | null;
  readyAt: Date | null;
  expiresAt: Date;
  deletedAt: Date | null;
  hiddenAt: Date | null;
};

/**
 * Whether anyone may join, play or see the images of a lobby at `now`:
 * finished being created, not expired, not deleted by its owner, not hidden
 * by reports, and its owner's account still exists. The SQL in
 * src/db/lobbies.ts (`visibleAt`) is the same rule; change both together.
 */
export function isLobbyPlayable(lobby: LobbyStatus, now: Date): boolean {
  return (
    lobby.ownerUserId !== null &&
    lobby.readyAt !== null &&
    lobby.deletedAt === null &&
    lobby.hiddenAt === null &&
    lobby.expiresAt.getTime() > now.getTime()
  );
}

// ---------------------------------------------------------------------------
// What the lobby Server Actions return (#68 consumes these)
// ---------------------------------------------------------------------------

export type LobbyError =
  /** Creating, uploading, listing or deleting needs an account. */
  | "login-required"
  /** The request was malformed (bad rounds, an upload that isn't yours). Like a 400. */
  | "invalid"
  /** No playable lobby with that code (never existed, expired, deleted or hidden: all look the same). */
  | "not-found"
  /** Too many requests in a short time. Nothing was changed. */
  | "rate-limited"
  /** A cap is reached: lobbies per player, pending uploads, or the storage budget. */
  | "cap-reached"
  /** The photo isn't JPEG, PNG, WebP or AVIF, or can't be read. */
  | "unsupported-image"
  /** The photo is over the upload limit. */
  | "too-large"
  /** Something else went wrong; logged on the server. */
  | "unavailable";

export type LobbyFailure = { ok: false; error: LobbyError };

/** What a player who joined sees before playing. No answers, no images. */
export type LobbySummary = { puzzleCount: number; expiresAt: string; yours: boolean };

/** One of the current player's own lobbies. `code` is shown only to its owner. */
export type OwnLobby = {
  id: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  puzzleCount: number;
  /** Hidden by reports (`REPORTS_TO_HIDE`): nobody else can play it until it's reviewed. */
  hidden: boolean;
  /** Finished games by anyone, for "N people played your lobby". */
  plays: number;
};
