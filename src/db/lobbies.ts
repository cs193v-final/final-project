// Custom lobbies in Postgres (#67). Owner: Jacky. Server-only (tests pass PGlite).
//
// The tables and why they look the way they do are described in schema.ts
// (search for "Custom lobbies"). In short: a lobby is a `packs` row of kind
// "lobby" with ordinary `puzzles` rows, so games, images and `game_rounds`
// work as for any pack; its answers, share code, uploads and
// image bytes are user data and stored only encrypted or as keyed hashes.
//
// No transactions (the Neon HTTP driver has none), so every multi-step write
// is ordered to be safe if it stops partway, and the sweep finishes the job:
// - creating: the lobby row is written early with `ready_at` NULL, and only
//   set ready at the end; an unfinished one can't be played and is purged;
// - deleting: `deleted_at` is set first (hidden at once), then `purgeLobby`
//   deletes games, puzzles (with their images) and the pack, in that order.
import "server-only";

import { and, asc, count, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { Vault } from "@/crypto/vault";
import { DecryptionError } from "@/crypto/vault";
import { isLobbyPlayable, LOBBY_LIFETIME_MS, type LobbyStatus, type OwnLobby } from "@/game/lobby";
import { GameNotFoundError } from "@/game/server-game";
import type { LeaderboardEntry, Pack, Puzzle, PuzzleEffect } from "@/game/types";

import { getPuzzles } from "./content";
import { imageSrc, newImageId } from "./images";
import type { Db } from "./index";
import { LEADERBOARD_SIZE, toEntries } from "./leaderboard";
import { rowsOf } from "./rows";
import {
  games,
  imageFiles,
  lobbies,
  lobbyPuzzles,
  lobbyUploads,
  packPuzzles,
  packs,
  puzzleImages,
  puzzles,
} from "./schema";

// ---------------------------------------------------------------------------
// Keys: which vault id and field encrypts what. Fixed strings; changing one
// makes every stored value unreadable.
// ---------------------------------------------------------------------------

export const CODE_INDEX_PURPOSE = "lobbies.code";
export const CODE_FIELD = "lobbies.code";
export const ANSWERS_FIELD = "lobby_puzzles.answers";
export const IMAGE_FIELD = "image_files.bytes";
export const UPLOAD_FIELD = "lobby_uploads.bytes";
export const REPORTER_PURPOSE = "lobby_reports.reporter";
export const REPORT_IP_PURPOSE = "lobby_reports.ip";

const lobbyKey = (lobbyId: string) => `lobby:${lobbyId.toLowerCase()}`;
const puzzleKey = (puzzleId: string) => `lobby-puzzle:${puzzleId}`;
const imageKey = (imageId: string) => `lobby-image:${imageId}`;
const uploadKey = (uploadId: string) => `lobby-upload:${uploadId}`;

/** The keyed hash a code is looked up by. `code` must already be normalized (`normalizeLobbyCode`). */
export const codeIndex = (vault: Vault, code: string) => vault.blindIndex(CODE_INDEX_PURPOSE, code);

/**
 * Lobby puzzle ids start with this, so the game's puzzle source only looks
 * for lobby answers when a game has lobby puzzles (src/server/games.ts).
 * Seeded content never uses it (its ids are `pz-…`).
 */
export const LOBBY_PUZZLE_PREFIX = "lobby-";

/** What every lobby's pack is called. Lobbies have no title of their own (less user text to store and moderate). */
export const LOBBY_PACK = { title: "Custom lobby", theme: "Photos from a friend" } as const;

/** Shown as the credit once a round ends. */
const LOBBY_CREDIT = { source: "The lobby's creator", license: "Shared by its creator for this lobby" } as const;

/**
 * A lobby still being created holds one of its owner's slots (and one of
 * the total) for this long; after that it no longer counts, and the sweep
 * purges it (`purgeDeadLobbies`).
 */
export const UNFINISHED_LOBBY_MS = 60 * 60 * 1000;

/**
 * Lobbies play timed rounds (#254) on the whole photo, so a lobby puzzle has
 * one stored image. `puzzles.zoom_levels` still needs at least two levels
 * ending in 1 (`puzzles_zoom_levels_valid`) until zoom levels are dropped,
 * so a lobby puzzle has two, and both levels' `puzzle_images` rows point to
 * that same image. Whichever level is shown, it's the full photo.
 */
export const LOBBY_PUZZLE_ZOOM_LEVELS: readonly number[] = [2, 1];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = (bytes: number) => newImageId().slice(0, bytes * 2);

const statusColumns = {
  ownerUserId: lobbies.ownerUserId,
  readyAt: lobbies.readyAt,
  expiresAt: lobbies.expiresAt,
  deletedAt: lobbies.deletedAt,
  hiddenAt: lobbies.hiddenAt,
};

/**
 * The lobbies that count toward the caps at `now`: not deleted or expired,
 * and ready or created less than `UNFINISHED_LOBBY_MS` ago. So a create that
 * stopped partway (never shown by `listOwnLobbies`) stops holding a slot
 * after an hour. Unqualified column names, so it works both in the create
 * statement's subqueries and in a query builder `where` on `lobbies`.
 */
function countsTowardCaps(now: Date) {
  const unfinishedSince = new Date(now.getTime() - UNFINISHED_LOBBY_MS).toISOString();
  return sql`(deleted_at IS NULL AND expires_at > ${now.toISOString()}::timestamptz
    AND (ready_at IS NOT NULL OR created_at > ${unfinishedSince}::timestamptz))`;
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export type StoredUpload = { bytes: Uint8Array; width: number; height: number };

export type UploadCaps = {
  /** Uploads a user may have waiting at once. */
  perUser: number;
  /** All waiting uploads together, in stored (encrypted) bytes. */
  totalBytes: number;
};

/**
 * Stores a re-encoded upload, encrypted, for `userId`. Returns its id, or
 * `null` if a cap is reached (nothing stored). One statement: the caps are
 * checked by the insert itself, so two uploads at once can't both slip under.
 */
export async function insertUpload(
  db: Db,
  vault: Vault,
  userId: string,
  upload: StoredUpload,
  caps: UploadCaps,
  now: Date,
): Promise<string | null> {
  const id = newImageId();
  const sealed = vault.encryptBytes(uploadKey(id), UPLOAD_FIELD, upload.bytes);
  const result = await db.execute(sql`
    INSERT INTO lobby_uploads (id, user_id, bytes, width, height, created_at)
    SELECT ${id}, ${userId}::uuid, ${Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength)},
           ${upload.width}, ${upload.height}, ${now.toISOString()}::timestamptz
    WHERE (SELECT count(*) FROM lobby_uploads WHERE user_id = ${userId}::uuid) < ${caps.perUser}
      AND (SELECT coalesce(sum(octet_length(bytes)), 0) FROM lobby_uploads) + ${sealed.byteLength} <= ${caps.totalBytes}
    RETURNING id
  `);
  return rowsOf(result).length > 0 ? id : null;
}

/** `userId`'s uploads with these ids, decrypted. Another user's upload, or one that doesn't decrypt, is left out. */
export async function getUploads(db: Db, vault: Vault, userId: string, ids: readonly string[]): Promise<Map<string, StoredUpload>> {
  const found = new Map<string, StoredUpload>();
  if (ids.length === 0) return found;
  const rows = await db
    .select({ id: lobbyUploads.id, bytes: lobbyUploads.bytes, width: lobbyUploads.width, height: lobbyUploads.height })
    .from(lobbyUploads)
    .where(and(eq(lobbyUploads.userId, userId), inArray(lobbyUploads.id, [...ids])));
  for (const row of rows) {
    try {
      found.set(row.id, { bytes: vault.decryptBytes(uploadKey(row.id), UPLOAD_FIELD, row.bytes), width: row.width, height: row.height });
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;
    }
  }
  return found;
}

export async function deleteUploads(db: Db, userId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(lobbyUploads).where(and(eq(lobbyUploads.userId, userId), inArray(lobbyUploads.id, [...ids])));
}

/** Deletes uploads made before `before` (never used for a lobby). Returns how many. */
export async function deleteStaleUploads(db: Db, before: Date): Promise<number> {
  const removed = await db.delete(lobbyUploads).where(lt(lobbyUploads.createdAt, before)).returning({ id: lobbyUploads.id });
  return removed.length;
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

export type NewLobbyRound = {
  answer: string;
  acceptedAnswers: string[];
  focus: { x: number; y: number };
  /** `Puzzle.effect`; left out, the game uses its default. */
  effect?: PuzzleEffect;
  /** The whole photo, as `reencodeUpload` stored it (WebP, no metadata). */
  photo: StoredUpload;
};

export type LobbyCaps = {
  /** Lobbies one user may have that aren't deleted or expired (hidden ones count). */
  perUser: number;
  /** Such lobbies across everyone. */
  total: number;
  /** Stored bytes of every lobby's images together, the new one included. A soft cap: see `createLobby`. */
  totalImageBytes: number;
};

export type CreatedLobby = { lobbyId: string; packId: string; expiresAt: Date };

/** Bytes of every lobby image stored now (encrypted). */
export async function lobbyImageBytes(db: Db): Promise<number> {
  const [row] = rowsOf(
    await db.execute(sql`
      SELECT coalesce(sum(octet_length(f.bytes)), 0)::bigint AS bytes
      FROM image_files f JOIN lobby_puzzles lp ON lp.puzzle_id = f.puzzle_id
    `),
  );
  return Number(row?.bytes ?? 0);
}

/**
 * Creates a lobby owned by `ownerUserId` that can be joined with `code`
 * (normalized) until `now + LOBBY_LIFETIME_MS`. Returns `null` if a cap is
 * reached (nothing is left behind). Rounds must already be validated
 * (`parseLobbyRounds`), with each photo from the user's uploads.
 *
 * Order (no transaction): pack, lobby row (not ready; this insert checks the
 * per-user and total caps), then each puzzle with its encrypted answers and
 * its encrypted photo, the play order, and last `ready_at`. If it stops
 * partway the lobby is never playable and `purgeDeadLobbies` removes it.
 *
 * The image-bytes cap is a **soft** cap: it's checked by its own query before
 * the inserts, so two creates at once can both pass it. The overshoot is at
 * most one lobby's photos per create in flight, and the lobby count caps
 * (checked by the insert itself) bound it.
 */
export async function createLobby(
  db: Db,
  vault: Vault,
  input: { ownerUserId: string; code: string; rounds: readonly NewLobbyRound[]; caps: LobbyCaps; now: Date },
): Promise<CreatedLobby | null> {
  const { ownerUserId, code, rounds, caps, now } = input;
  // 29 bytes of encryption overhead per image (Vault.encryptBytes).
  const newBytes = rounds.reduce((sum, r) => sum + r.photo.bytes.byteLength + 29, 0);
  if ((await lobbyImageBytes(db)) + newBytes > caps.totalImageBytes) return null;

  const packId = `lobby-pack-${hex(12)}`;
  const expiresAt = new Date(now.getTime() + LOBBY_LIFETIME_MS);
  await db.insert(packs).values({ id: packId, kind: "lobby", title: LOBBY_PACK.title, theme: LOBBY_PACK.theme });

  const lobbyId = crypto.randomUUID();
  const active = countsTowardCaps(now);
  let inserted: Record<string, unknown>[];
  try {
    inserted = rowsOf(
      await db.execute(sql`
        INSERT INTO lobbies (id, owner_user_id, pack_id, code_index, code_encrypted, created_at, expires_at)
        SELECT ${lobbyId}::uuid, ${ownerUserId}::uuid, ${packId}, ${codeIndex(vault, code)},
               ${vault.encrypt(lobbyKey(lobbyId), CODE_FIELD, code)},
               ${now.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz
        WHERE (SELECT count(*) FROM lobbies WHERE owner_user_id = ${ownerUserId}::uuid AND ${active}) < ${caps.perUser}
          AND (SELECT count(*) FROM lobbies WHERE ${active}) < ${caps.total}
        RETURNING id
      `),
    );
  } catch (error) {
    // Nothing points at the pack yet, so the sweep would never find it.
    await db.delete(packs).where(eq(packs.id, packId));
    throw error;
  }
  if (inserted.length === 0) {
    await db.delete(packs).where(eq(packs.id, packId));
    return null;
  }

  const puzzleIds: string[] = [];
  for (const round of rounds) {
    const puzzleId = `${LOBBY_PUZZLE_PREFIX}${hex(12)}`;
    puzzleIds.push(puzzleId);
    const imageId = newImageId();
    const src = imageSrc(imageId);
    const { photo } = round;
    await db.insert(puzzles).values({
      id: puzzleId,
      // The answers are only in lobby_puzzles, encrypted (see schema.ts).
      answer: "",
      acceptedAnswers: [],
      imageUrl: src,
      focusX: round.focus.x,
      focusY: round.focus.y,
      zoomLevels: [...LOBBY_PUZZLE_ZOOM_LEVELS],
      creditSource: LOBBY_CREDIT.source,
      creditLicense: LOBBY_CREDIT.license,
      effect: round.effect ?? null,
    });
    await db.insert(lobbyPuzzles).values({
      puzzleId,
      lobbyId,
      answersEncrypted: vault.encryptJson(puzzleKey(puzzleId), ANSWERS_FIELD, {
        answer: round.answer,
        acceptedAnswers: round.acceptedAnswers,
      }),
    });
    // One image per statement keeps each request small (Neon HTTP limits request size).
    await db.insert(imageFiles).values({
      id: imageId,
      puzzleId,
      contentType: "image/webp",
      bytes: vault.encryptBytes(imageKey(imageId), IMAGE_FIELD, photo.bytes),
      width: photo.width,
      height: photo.height,
    });
    await db
      .insert(puzzleImages)
      .values(LOBBY_PUZZLE_ZOOM_LEVELS.map((_, level) => ({ puzzleId, level, src, width: photo.width, height: photo.height })));
  }
  await db.insert(packPuzzles).values(puzzleIds.map((puzzleId, i) => ({ packId, puzzleId, position: i + 1 })));
  await db.update(lobbies).set({ readyAt: now }).where(eq(lobbies.id, lobbyId));
  return { lobbyId, packId, expiresAt };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type PlayableLobby = { id: string; packId: string; ownerUserId: string; expiresAt: Date; puzzleIds: string[] };

async function puzzleOrder(db: Db, packId: string): Promise<string[]> {
  const rows = await db
    .select({ puzzleId: packPuzzles.puzzleId })
    .from(packPuzzles)
    .where(eq(packPuzzles.packId, packId))
    .orderBy(asc(packPuzzles.position));
  return rows.map((r) => r.puzzleId);
}

/** The lobby `code` (normalized) opens, if it can be played at `now`; otherwise `null`, whatever the reason. */
export async function findPlayableLobby(db: Db, vault: Vault, code: string, now: Date): Promise<PlayableLobby | null> {
  const [row] = await db
    .select({ id: lobbies.id, packId: lobbies.packId, ...statusColumns })
    .from(lobbies)
    .where(eq(lobbies.codeIndex, codeIndex(vault, code)));
  if (row === undefined || !isLobbyPlayable(row, now)) return null;
  return { id: row.id, packId: row.packId, ownerUserId: row.ownerUserId!, expiresAt: row.expiresAt, puzzleIds: await puzzleOrder(db, row.packId) };
}

/** A lobby's pack, as the game service plays it. */
export function lobbyPack(lobby: PlayableLobby): Pack {
  return { id: lobby.packId, kind: "lobby", title: LOBBY_PACK.title, theme: LOBBY_PACK.theme, puzzleIds: lobby.puzzleIds };
}

export type LobbyAnswers = { answer: string; acceptedAnswers: string[] };

/** One of the requested puzzles belongs to a lobby that can't be played any more (deleted, expired, hidden). */
export class LobbyGoneError extends Error {
  constructor() {
    super("this lobby can't be played any more");
    this.name = "LobbyGoneError";
  }
}

/**
 * The decrypted answers of those of `puzzleIds` that are lobby puzzles. Throws
 * `LobbyGoneError` if any belongs to a lobby that can't be played at `now`,
 * so a game of a deleted, expired or hidden lobby stops at its next move.
 * Server-only: the answers never go to the browser before a round ends.
 */
export async function getLobbyAnswers(db: Db, vault: Vault, puzzleIds: readonly string[], now: Date): Promise<Map<string, LobbyAnswers>> {
  const answers = new Map<string, LobbyAnswers>();
  const ids = puzzleIds.filter((id) => id.startsWith(LOBBY_PUZZLE_PREFIX));
  if (ids.length === 0) return answers;
  const rows = await db
    .select({ puzzleId: lobbyPuzzles.puzzleId, answersEncrypted: lobbyPuzzles.answersEncrypted, ...statusColumns })
    .from(lobbyPuzzles)
    .innerJoin(lobbies, eq(lobbies.id, lobbyPuzzles.lobbyId))
    .where(inArray(lobbyPuzzles.puzzleId, ids));
  for (const row of rows) {
    if (!isLobbyPlayable(row, now)) throw new LobbyGoneError();
    answers.set(row.puzzleId, vault.decryptJson<LobbyAnswers>(puzzleKey(row.puzzleId), ANSWERS_FIELD, row.answersEncrypted));
  }
  return answers;
}

/**
 * Puzzles from the database (`getPuzzles`), with each lobby puzzle's answers
 * filled in from `lobby_puzzles` (its `puzzles` row has an empty answer). The
 * game's puzzle source for every pack but practice (src/server/games.ts). A
 * puzzle of a lobby that can't be played any more (deleted, expired, hidden)
 * throws `GameNotFoundError`, so the game ends as `not-found`; so does any
 * puzzle still without an answer, so an empty answer is never played.
 */
export async function getPuzzlesWithLobbyAnswers(db: Db, vault: Vault, ids: readonly string[], now: Date): Promise<Puzzle[]> {
  const found = await getPuzzles(db, ids);
  let answers: Map<string, LobbyAnswers>;
  try {
    answers = await getLobbyAnswers(db, vault, ids, now);
  } catch (error) {
    if (error instanceof LobbyGoneError) throw new GameNotFoundError();
    throw error;
  }
  return found.map((puzzle) => {
    const lobby = answers.get(puzzle.id);
    const filled = lobby === undefined ? puzzle : { ...puzzle, answer: lobby.answer, acceptedAnswers: [...lobby.acceptedAnswers] };
    if (filled.answer === "") throw new GameNotFoundError();
    return filled;
  });
}

/**
 * The current lobbies of `userId` (not deleted, not expired), newest first,
 * each with its code (decrypted for its owner only) and how many games of it
 * have been finished.
 */
export async function listOwnLobbies(db: Db, vault: Vault, userId: string, now: Date): Promise<OwnLobby[]> {
  if (!UUID.test(userId)) return [];
  const rows = await db
    .select({
      id: lobbies.id,
      codeEncrypted: lobbies.codeEncrypted,
      createdAt: lobbies.createdAt,
      expiresAt: lobbies.expiresAt,
      hiddenAt: lobbies.hiddenAt,
      // Spelled out: inside a subquery, drizzle's unqualified "pack_id" would mean the subquery's own column.
      puzzleCount: sql<number>`(SELECT count(*)::int FROM pack_puzzles pp WHERE pp.pack_id = "lobbies"."pack_id")`,
      plays: sql<number>`(SELECT count(*)::int FROM games g WHERE g.pack_id = "lobbies"."pack_id" AND g.finished_at IS NOT NULL)`,
    })
    .from(lobbies)
    .where(
      and(
        eq(lobbies.ownerUserId, userId),
        isNull(lobbies.deletedAt),
        sql`${lobbies.readyAt} IS NOT NULL`,
        gt(lobbies.expiresAt, now),
      ),
    )
    .orderBy(sql`${lobbies.createdAt} DESC`);
  return rows.map((r) => ({
    id: r.id,
    code: vault.decrypt(lobbyKey(r.id), CODE_FIELD, r.codeEncrypted),
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    puzzleCount: Number(r.puzzleCount),
    hidden: r.hiddenAt !== null,
    plays: Number(r.plays),
  }));
}

/**
 * An image for `GET /img/<id>.webp`: a seeded puzzle's (`lobby: false`,
 * served as stored), or a lobby's, with whether its lobby can be played at
 * `now` (only then may it be served). `bytes()` returns the bytes to serve,
 * decrypting a lobby image only when called, so the caller can rate-limit
 * first. `null` if there's no such image.
 */
export async function findServableImage(
  db: Db,
  vault: Pick<Vault, "decryptBytes">,
  id: string,
  now: Date,
): Promise<{ contentType: string; bytes: () => Uint8Array; lobby: boolean; playable: boolean } | null> {
  const [row] = await db
    .select({
      contentType: imageFiles.contentType,
      bytes: imageFiles.bytes,
      lobbyId: lobbies.id,
      ...statusColumns,
    })
    .from(imageFiles)
    .leftJoin(lobbyPuzzles, eq(lobbyPuzzles.puzzleId, imageFiles.puzzleId))
    .leftJoin(lobbies, eq(lobbies.id, lobbyPuzzles.lobbyId))
    .where(eq(imageFiles.id, id));
  if (row === undefined) return null;
  const stored = row.bytes;
  if (row.lobbyId === null) return { contentType: row.contentType, bytes: () => stored, lobby: false, playable: true };
  const playable = isLobbyPlayable(row as LobbyStatus, now);
  // Not decrypted unless it's going to be served.
  const bytes = () => (playable ? vault.decryptBytes(imageKey(id), IMAGE_FIELD, stored) : new Uint8Array(0));
  return { contentType: row.contentType, bytes, lobby: true, playable };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export type LobbyBoard = { top: LeaderboardEntry[]; players: number; you: LeaderboardEntry | null };

/**
 * A lobby's leaderboard: each logged-in player's **first** finished game of
 * it (so replaying a lobby you now know the answers to doesn't count),
 * ranked like the daily board (competition ranks, ties by who finished
 * first), top `LEADERBOARD_SIZE`, plus `userId`'s own entry. Anonymous games
 * don't count, as for the daily (#58). `beatAi` is always 0: the AI (CLIP)
 * runs only in scripts, on seeded photos, so a lobby photo never has an AI
 * result to beat (whether by level or, after #257, by solve time).
 */
export async function getLobbyBoard(db: Db, vault: Vault, packId: string, userId: string | null): Promise<LobbyBoard> {
  const board = sql`
    WITH firsts AS (
      SELECT DISTINCT ON (g.user_id) g.id, g.user_id, g.total, g.finished_at
      FROM games g
      WHERE g.pack_id = ${packId} AND g.user_id IS NOT NULL AND g.finished_at IS NOT NULL
      ORDER BY g.user_id, g.finished_at, g.id
    ), board AS (
      SELECT f.*, rank() OVER (ORDER BY f.total DESC) AS rank, count(*) OVER () AS players FROM firsts f
    )
    SELECT g.rank, g.total AS score, g.user_id, g.players, u.username_encrypted, 0 AS beat_ai
    FROM board g JOIN users u ON u.id = g.user_id
  `;
  const top = rowsOf(await db.execute(sql`${board} ORDER BY g.rank, g.finished_at, g.id LIMIT ${LEADERBOARD_SIZE}`));
  const mine = userId !== null && UUID.test(userId) ? rowsOf(await db.execute(sql`${board} WHERE g.user_id = ${userId}::uuid`)) : [];
  const players = Number(top[0]?.players ?? 0);
  return { top: toEntries(vault, top), players, you: toEntries(vault, mine)[0] ?? null };
}

// ---------------------------------------------------------------------------
// Delete, report, expire
// ---------------------------------------------------------------------------

/**
 * Marks `userId`'s lobby deleted (hidden from everyone at once). Returns
 * whether it was theirs and not deleted already. Purge it next (`purgeLobby`).
 */
export async function markLobbyDeleted(db: Db, lobbyId: string, userId: string, now: Date): Promise<boolean> {
  if (!UUID.test(lobbyId) || !UUID.test(userId)) return false;
  const rows = await db
    .update(lobbies)
    .set({ deletedAt: now })
    .where(and(eq(lobbies.id, lobbyId), eq(lobbies.ownerUserId, userId), isNull(lobbies.deletedAt)))
    .returning({ id: lobbies.id });
  return rows.length > 0;
}

/**
 * Deletes everything of one lobby: its games (and their rounds), its puzzles
 * (and their answers, level images and URLs), then its pack, which deletes
 * the lobby row and its reports. Each step can be run again, and the lobby
 * row goes last, so a purge that stops partway is finished by the next one.
 */
export async function purgeLobby(db: Db, lobbyId: string): Promise<void> {
  const [lobby] = await db.select({ packId: lobbies.packId }).from(lobbies).where(eq(lobbies.id, lobbyId));
  if (lobby === undefined) return;
  // game_rounds cascade from games; they reference puzzles (RESTRICT), so games go first.
  await db.delete(games).where(eq(games.packId, lobby.packId));
  // pack_puzzles references puzzles (RESTRICT) too.
  await db.delete(packPuzzles).where(eq(packPuzzles.packId, lobby.packId));
  // Cascades to lobby_puzzles, image_files and puzzle_images.
  await db
    .delete(puzzles)
    .where(inArray(puzzles.id, db.select({ id: lobbyPuzzles.puzzleId }).from(lobbyPuzzles).where(eq(lobbyPuzzles.lobbyId, lobbyId))));
  // Cascades to lobbies and lobby_reports.
  await db.delete(packs).where(eq(packs.id, lobby.packId));
}

/**
 * Purges lobbies that can't come back: deleted by their owner, expired, whose
 * owner's account is gone, or never finished being created (older than
 * `unfinishedAfterMs`). At most `limit` per call, oldest expiry first, so one
 * sweep stays short. Hidden (reported) lobbies stay until they expire, for
 * review. Returns how many were purged.
 */
export async function purgeDeadLobbies(db: Db, now: Date, { unfinishedAfterMs = UNFINISHED_LOBBY_MS, limit = 50 } = {}): Promise<number> {
  const dead = await db
    .select({ id: lobbies.id })
    .from(lobbies)
    .where(
      or(
        sql`${lobbies.deletedAt} IS NOT NULL`,
        lte(lobbies.expiresAt, now),
        isNull(lobbies.ownerUserId),
        and(isNull(lobbies.readyAt), lt(lobbies.createdAt, new Date(now.getTime() - unfinishedAfterMs))),
      ),
    )
    .orderBy(asc(lobbies.expiresAt))
    .limit(limit);
  for (const { id } of dead) await purgeLobby(db, id);
  return dead.length;
}

export type ReportOutcome = { counted: boolean; hidden: boolean };

/** Who reported: their owner key, whether they're logged in, and their IP hash. */
export type Reporter = {
  /** `user:<id>` or `anon:<owner hash>` (`ownerKey`); stored only as a keyed hash. */
  key: string;
  /** Only logged-in reports count toward hiding. */
  signedIn: boolean;
  /** `requestIpHash()`; `null` (no per-IP limits, e.g. loopback in dev) counts as one shared address. */
  ipHash: string | null;
};

/**
 * Records one report of a lobby. Each reporter is stored once per lobby
 * (`counted` says whether this one was new). The lobby is hidden
 * (`hidden_at`) until someone reviews it once `reportsToHide` distinct
 * logged-in users have reported it from at least `reportsToHide` distinct
 * addresses. Anonymous reports are recorded but never count: an anonymous
 * owner is only a cookie, so one person could otherwise hide a lobby from a
 * few private windows; and requiring distinct addresses means one person
 * with a few accounts can't either. `report_count` is the logged-in reports.
 * Only a playable lobby can be reported, so a hidden one gets no more rows.
 *
 * Two statements (no transactions on Neon HTTP): the insert, then a recount
 * from the table, so two reports at once still hide it once both are in.
 */
export async function reportLobby(
  db: Db,
  vault: Vault,
  lobbyId: string,
  reporter: Reporter,
  reportsToHide: number,
  now: Date,
): Promise<ReportOutcome> {
  const reporterIndex = vault.blindIndex(REPORTER_PURPOSE, reporter.key);
  const ipIndex = vault.blindIndex(REPORT_IP_PURPOSE, reporter.ipHash ?? "none");
  const nowIso = now.toISOString();
  const added = rowsOf(
    await db.execute(sql`
      WITH target AS (
        SELECT id FROM lobbies
        WHERE id = ${lobbyId}::uuid AND owner_user_id IS NOT NULL AND ready_at IS NOT NULL
          AND deleted_at IS NULL AND hidden_at IS NULL AND expires_at > ${nowIso}::timestamptz
      )
      INSERT INTO lobby_reports (lobby_id, reporter_index, ip_index, signed_in, created_at)
      SELECT id, ${reporterIndex}, ${ipIndex}, ${reporter.signedIn}, ${nowIso}::timestamptz FROM target
      ON CONFLICT DO NOTHING
      RETURNING lobby_id
    `),
  );
  if (added.length === 0) return { counted: false, hidden: false };
  if (!reporter.signedIn) return { counted: true, hidden: false };
  const [row] = rowsOf(
    await db.execute(sql`
      WITH tally AS (
        SELECT count(*)::int AS reports, count(DISTINCT ip_index)::int AS addresses
        FROM lobby_reports WHERE lobby_id = ${lobbyId}::uuid AND signed_in
      )
      UPDATE lobbies SET
        report_count = tally.reports,
        hidden_at = COALESCE(
          hidden_at,
          CASE WHEN tally.reports >= ${reportsToHide} AND tally.addresses >= ${reportsToHide} THEN ${nowIso}::timestamptz END
        )
      FROM tally
      WHERE id = ${lobbyId}::uuid
      RETURNING hidden_at
    `),
  );
  return { counted: true, hidden: row !== undefined && row.hidden_at !== null };
}

/**
 * How many lobbies of `userId` count toward the per-user cap
 * (`countsTowardCaps`). For tests and the create screen.
 */
export async function countActiveLobbies(db: Db, userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(lobbies)
    .where(and(eq(lobbies.ownerUserId, userId), countsTowardCaps(now)));
  return Number(row?.n ?? 0);
}
