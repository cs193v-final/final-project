// Per-level puzzle images in Postgres (#57). Owner: Darian.
//
// Each cut level (src/images/cut.ts) is stored in `image_files` under a random
// 128-bit id, and `puzzle_images` maps (puzzle, level) to its URL,
// `/img/<id>.webp`, served by src/app/img/[file]/route.ts. The id is the only
// protection: the server sends a level's URL only once the player has reached
// that level, and no URL can be worked out from another.
//
// No "server-only" import, so the cutting script can run this in Node, like
// src/db/content.ts. It's still only for server code and scripts: it reads
// image bytes and the level URLs of every puzzle.

import { randomBytes } from "node:crypto";

import { and, asc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { imageFiles, puzzleImages, puzzles } from "./schema.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any schema, any driver
export type AnyDb = PgDatabase<PgQueryResultHKT, any>;

/** An image id: 32 lowercase hex characters (128 random bits). */
export const IMAGE_ID = /^[0-9a-f]{32}$/;

export function newImageId(): string {
  return randomBytes(16).toString("hex");
}

/** The URL a level image is served at. */
export function imageSrc(id: string): string {
  return `/img/${id}.webp`;
}

/** What `saveLevelImages` stores for one level: the output of `cutLevels`. */
export type LevelImageInput = {
  level: number;
  width: number;
  height: number;
  contentType: "image/webp";
  bytes: Uint8Array;
};

export type StoredLevel = { level: number; src: string; width: number; height: number };

/**
 * Largest image file one level may be: well under Vercel's 4.5 MB function
 * response limit and Neon's request size, and about 3× a typical 1600 px level
 * (security audit L7, #95).
 */
export const MAX_LEVEL_BYTES = 1024 * 1024;

/**
 * Store a puzzle's cut levels and point `puzzle_images` at them, replacing
 * any earlier cut: its old files are deleted, and so are rows for levels the
 * puzzle no longer has. Every level gets a fresh random id, so a URL that was
 * ever sent stays tied to that one image. The puzzle must already be in
 * `puzzles` (seed it first, #52).
 *
 * No transaction (the Neon HTTP driver has none), so the order is chosen to
 * stay safe if it stops partway: new files first, then the URLs, then old
 * files. Running it again finishes the job.
 */
export async function saveLevelImages(
  db: AnyDb,
  puzzleId: string,
  levels: readonly LevelImageInput[],
): Promise<StoredLevel[]> {
  if (levels.length === 0) throw new Error(`saveLevelImages: no levels for puzzle "${puzzleId}"`);
  levels.forEach((l, i) => {
    if (l.level !== i) throw new Error(`saveLevelImages: levels must be 0..${levels.length - 1} in order`);
    if (l.bytes.byteLength > MAX_LEVEL_BYTES) {
      throw new Error(`saveLevelImages: level ${i} of "${puzzleId}" is ${l.bytes.byteLength} bytes, over the ${MAX_LEVEL_BYTES}-byte limit`);
    }
  });
  // The database can't check a level against the puzzle's own zoom levels
  // (#82), so check here: exactly one image per zoom level.
  const [puzzle] = await db
    .select({ zoomLevels: puzzles.zoomLevels })
    .from(puzzles)
    .where(eq(puzzles.id, puzzleId));
  if (puzzle === undefined) throw new Error(`saveLevelImages: no puzzle "${puzzleId}" (seed it first)`);
  if (levels.length !== puzzle.zoomLevels.length) {
    throw new Error(
      `saveLevelImages: puzzle "${puzzleId}" has ${puzzle.zoomLevels.length} zoom levels, but ${levels.length} images were given`,
    );
  }

  const stored: (StoredLevel & { id: string })[] = levels.map((l) => {
    const id = newImageId();
    return { id, level: l.level, src: imageSrc(id), width: l.width, height: l.height };
  });

  // One image per statement keeps each request small (Neon HTTP limits request size).
  for (const [i, l] of levels.entries()) {
    const { id } = stored[i]!;
    await db.insert(imageFiles).values({
      id,
      puzzleId,
      contentType: l.contentType,
      bytes: l.bytes,
      width: l.width,
      height: l.height,
    });
  }

  await db
    .insert(puzzleImages)
    .values(stored.map(({ level, src, width, height }) => ({ puzzleId, level, src, width, height })))
    .onConflictDoUpdate({
      target: [puzzleImages.puzzleId, puzzleImages.level],
      set: { src: sql`excluded.src`, width: sql`excluded.width`, height: sql`excluded.height` },
    });
  await db.delete(puzzleImages).where(and(eq(puzzleImages.puzzleId, puzzleId), gte(puzzleImages.level, levels.length)));
  await db.delete(imageFiles).where(
    and(
      eq(imageFiles.puzzleId, puzzleId),
      notInArray(
        imageFiles.id,
        stored.map((s) => s.id),
      ),
    ),
  );

  return stored.map(({ level, src, width, height }) => ({ level, src, width, height }));
}

/**
 * One stored image's row, or null if there's no image with this id. For
 * scripts and tests only: `GET /img/<id>.webp` reads through
 * `findServableImage` (src/db/lobbies.ts), which checks a lobby image's lobby
 * and decrypts it. A lobby image's `bytes` here are **ciphertext**
 * (`Vault.encryptBytes`), so never serve them from this.
 */
export async function getImageFile(
  db: AnyDb,
  id: string,
): Promise<{ contentType: string; bytes: Uint8Array } | null> {
  if (!IMAGE_ID.test(id)) return null;
  const [row] = await db
    .select({ contentType: imageFiles.contentType, bytes: imageFiles.bytes })
    .from(imageFiles)
    .where(eq(imageFiles.id, id));
  return row ?? null;
}

/**
 * Each puzzle's level URLs, index = reveal level. Server-only: the game sends
 * only `srcs[revealLevel]` to the browser (`PublicRound.imageSrc`).
 *
 * Every list is complete from level 0 with no gaps, so `srcs[level]` is a URL
 * for every level below `srcs.length`. A puzzle with no cut images, or with a
 * gap in its levels (e.g. a cut that stopped partway), isn't in the map.
 * Callers still compare `srcs.length` with the puzzle's number of zoom levels.
 */
export async function getLevelSrcs(db: AnyDb, puzzleIds: readonly string[]): Promise<Map<string, string[]>> {
  const srcs = new Map<string, string[]>();
  if (puzzleIds.length === 0) return srcs;
  const rows = await db
    .select({ puzzleId: puzzleImages.puzzleId, level: puzzleImages.level, src: puzzleImages.src })
    .from(puzzleImages)
    .where(inArray(puzzleImages.puzzleId, [...puzzleIds]))
    .orderBy(asc(puzzleImages.puzzleId), asc(puzzleImages.level));
  const gaps = new Set<string>();
  for (const row of rows) {
    const list = srcs.get(row.puzzleId) ?? [];
    // Rows come in level order, so a level other than the next index is a gap.
    if (row.level !== list.length) gaps.add(row.puzzleId);
    list.push(row.src);
    srcs.set(row.puzzleId, list);
  }
  for (const id of gaps) srcs.delete(id);
  return srcs;
}
