// Cuts seeded puzzles into one image per zoom level (#57), as part of
// `npm run db:seed`. Script-only: uses `sharp` (through src/images/cut.ts).
//
// A puzzle's `imageUrl` says where its original photo is:
// - `/puzzles/…` (the practice pack): `public/puzzles/…` in the repo;
// - a relative path (private content): next to the content file it's in,
//   e.g. `images/fig.jpg` beside `content/fruit.json`. That path is never sent
//   to a browser: once a puzzle is cut, the game only sends level URLs.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { inArray } from "drizzle-orm";

import { getLevelSrcs, saveLevelImages, type AnyDb } from "../src/db/images.ts";
import { puzzles as puzzlesTable } from "../src/db/schema.ts";
import type { Puzzle } from "../src/game/types.ts";
import { cutLevels } from "../src/images/cut.ts";

/** What decides how a puzzle's levels look: if any of it changes, the puzzle is cut again. */
export type ImageSettings = { imageUrl: string; focusX: number; focusY: number; zoomLevels: readonly number[] };

export const settingsOf = (p: Puzzle): ImageSettings => ({
  imageUrl: p.imageUrl,
  focusX: p.reveal.focus.x,
  focusY: p.reveal.focus.y,
  zoomLevels: p.reveal.zoomLevels,
});

export const sameSettings = (a: ImageSettings, b: ImageSettings) =>
  a.imageUrl === b.imageUrl &&
  a.focusX === b.focusX &&
  a.focusY === b.focusY &&
  a.zoomLevels.length === b.zoomLevels.length &&
  a.zoomLevels.every((z, i) => z === b.zoomLevels[i]);

/** The image settings stored for these puzzles now. Read it before seeding, to know what changed. */
export async function storedImageSettings(db: AnyDb, ids: readonly string[]): Promise<Map<string, ImageSettings>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: puzzlesTable.id,
      imageUrl: puzzlesTable.imageUrl,
      focusX: puzzlesTable.focusX,
      focusY: puzzlesTable.focusY,
      zoomLevels: puzzlesTable.zoomLevels,
    })
    .from(puzzlesTable)
    .where(inArray(puzzlesTable.id, [...ids]));
  return new Map(rows.map(({ id, ...settings }) => [id, settings]));
}

/**
 * Where `puzzle`'s original photo is on disk. `contentDir` is the folder of the
 * content file it came from, or null for the practice pack. Throws, naming the
 * puzzle, for a remote URL or a file that doesn't exist.
 */
export function originalPath(puzzle: Pick<Puzzle, "id" | "imageUrl">, contentDir: string | null, repoRoot: string): string {
  const url = puzzle.imageUrl;
  // A scheme of two or more letters (`https:`, `data:`) or a protocol-relative
  // `//host/...`. One letter is a Windows drive (`C:\photos\fig.jpg`), a local path.
  if (/^(?:[a-z][a-z0-9+.-]+:|\/\/)/iu.test(url)) {
    throw new Error(`puzzle ${puzzle.id}: imageUrl "${url}" is a remote URL; download the original into content/ and give its path instead`);
  }
  // Both branches give an absolute path.
  const file = url.startsWith("/") ? join(repoRoot, "public", url) : resolve(contentDir ?? repoRoot, url);
  if (!existsSync(file)) {
    throw new Error(`puzzle ${puzzle.id}: no original image at ${file} (imageUrl "${url}")`);
  }
  return file;
}

export type CutSummary = { cut: number; alreadyCut: number };

/**
 * Cut each puzzle into its level images and store them (`saveLevelImages`),
 * unless it's already fully cut with the same image settings it has now.
 * `before` is what `storedImageSettings` returned before this seed; `recut`
 * cuts everything again.
 */
export async function cutPuzzleImages(
  db: AnyDb,
  puzzles: readonly Puzzle[],
  originalOf: (puzzle: Puzzle) => string,
  { before = new Map<string, ImageSettings>(), recut = false }: { before?: ReadonlyMap<string, ImageSettings>; recut?: boolean } = {},
): Promise<CutSummary> {
  const existing = await getLevelSrcs(db, puzzles.map((p) => p.id));
  const summary: CutSummary = { cut: 0, alreadyCut: 0 };
  for (const puzzle of puzzles) {
    // getLevelSrcs only returns lists with no gaps, so the length says whether every level is cut.
    const complete = existing.get(puzzle.id)?.length === puzzle.reveal.zoomLevels.length;
    const previous = before.get(puzzle.id);
    const unchanged = previous !== undefined && sameSettings(previous, settingsOf(puzzle));
    if (!recut && complete && unchanged) {
      summary.alreadyCut++;
      continue;
    }
    const levels = await cutLevels(new Uint8Array(readFileSync(originalOf(puzzle))), puzzle.reveal);
    await saveLevelImages(db, puzzle.id, levels);
    summary.cut++;
  }
  return summary;
}
