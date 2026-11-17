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

import { createHash, randomBytes } from "node:crypto";

import { and, asc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { Puzzle } from "../game/types.ts";
import { imageFiles, puzzleImages, puzzles } from "./schema.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any schema, any driver
export type AnyDb = PgDatabase<PgQueryResultHKT, any>;

/** An image id: 32 lowercase hex characters (128 random bits). */
export const IMAGE_ID = /^[0-9a-f]{32}$/;

export function newImageId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * What a set of level images is cut from: the source image and the crop
 * settings. Stored with the cuts (`puzzle_images.cut_from`); when the puzzle's
 * current values give a different fingerprint, its cuts are stale.
 */
export function cutFingerprint(puzzle: Pick<Puzzle, "imageUrl" | "reveal">): string {
  const { imageUrl, reveal } = puzzle;
  const source = JSON.stringify([imageUrl, reveal.focus.x, reveal.focus.y, reveal.zoomLevels]);
  return createHash("sha256").update(source).digest("hex").slice(0, 32);
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
  /** `cutFingerprint` of the puzzle these were cut from. Without it the cuts are never used by the game. */
  cutFrom: string | null = null,
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
    .values(stored.map(({ level, src, width, height }) => ({ puzzleId, level, src, width, height, cutFrom })))
    .onConflictDoUpdate({
      target: [puzzleImages.puzzleId, puzzleImages.level],
      set: {
        src: sql`excluded.src`,
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        cutFrom: sql`excluded.cut_from`,
      },
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

/** One stored image, or null if there's no image with this id. */
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
 * only `srcs[revealLevel]` to the browser (`PublicRound.imageSrc`). A puzzle
 * with no cut images isn't in the map.
 */
export async function getLevelSrcs(db: AnyDb, puzzleIds: readonly string[]): Promise<Map<string, string[]>> {
  const srcs = new Map<string, string[]>();
  if (puzzleIds.length === 0) return srcs;
  const rows = await db
    .select({ puzzleId: puzzleImages.puzzleId, level: puzzleImages.level, src: puzzleImages.src })
    .from(puzzleImages)
    .where(inArray(puzzleImages.puzzleId, [...puzzleIds]))
    .orderBy(asc(puzzleImages.puzzleId), asc(puzzleImages.level));
  for (const row of rows) {
    const list = srcs.get(row.puzzleId) ?? [];
    list[row.level] = row.src;
    srcs.set(row.puzzleId, list);
  }
  return srcs;
}

/**
 * The level URLs of each puzzle that has a complete and current set of cuts:
 * one per zoom level, all cut from the puzzle as it is now (`cutFingerprint`).
 * A puzzle with missing, extra-old or stale cuts isn't in the map, so the game
 * never shows a crop that no longer matches the puzzle.
 */
export async function getCurrentLevelSrcs(
  db: AnyDb,
  puzzleList: readonly Pick<Puzzle, "id" | "imageUrl" | "reveal">[],
): Promise<Map<string, string[]>> {
  const current = new Map<string, string[]>();
  if (puzzleList.length === 0) return current;
  const rows = await db
    .select({ puzzleId: puzzleImages.puzzleId, level: puzzleImages.level, src: puzzleImages.src, cutFrom: puzzleImages.cutFrom })
    .from(puzzleImages)
    .where(inArray(puzzleImages.puzzleId, puzzleList.map((p) => p.id)))
    .orderBy(asc(puzzleImages.puzzleId), asc(puzzleImages.level));
  for (const puzzle of puzzleList) {
    const fingerprint = cutFingerprint(puzzle);
    const mine = rows.filter((r) => r.puzzleId === puzzle.id);
    const levels = puzzle.reveal.zoomLevels.length;
    const complete = mine.length === levels && mine.every((r, i) => r.level === i && r.cutFrom === fingerprint);
    if (complete) current.set(puzzle.id, mine.map((r) => r.src));
  }
  return current;
}
