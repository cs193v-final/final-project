// The cut command's core (#57 follow-up, #58): cut every seeded puzzle that
// has no current level images into one WebP per zoom level, and store them
// with the fingerprint of what they were cut from. Owner: Joseph (with
// Darian's #83 cutting and storage). Used by scripts/cut-images.ts; tested on
// PGlite with real images.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { AnyDb } from "../src/db/content.ts";
import { cutFingerprint, getCurrentLevelSrcs, saveLevelImages } from "../src/db/images.ts";
import { puzzles } from "../src/db/schema.ts";
import type { Puzzle } from "../src/game/types.ts";
import { cutLevels, MAX_INPUT_PIXELS } from "../src/images/cut.ts";

/** Bigger than any photo we'd use; refuses a mistaken huge download or file. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export type CutPuzzle = Pick<Puzzle, "id" | "imageUrl" | "reveal">;

export type CutReport = {
  cut: string[]; // cut and stored now
  current: string[]; // already had current cuts, left alone
  failed: { id: string; problem: string }[];
};

/**
 * Where a puzzle's `imageUrl` is read from: `https://…` is downloaded; a path
 * starting with `/` is a file in `public/` (like the practice pack); anything
 * else is a file relative to the repo root (e.g. `content/images/pz-….jpg`,
 * the git-ignored private content).
 */
export async function readSource(imageUrl: string, root: string): Promise<Uint8Array> {
  if (/^https?:\/\//u.test(imageUrl)) {
    const response = await fetch(imageUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`downloading ${imageUrl}: HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_SOURCE_BYTES) throw new Error(`${imageUrl} is ${length} bytes, over ${MAX_SOURCE_BYTES}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error(`${imageUrl} is over ${MAX_SOURCE_BYTES} bytes`);
    return bytes;
  }
  const file = imageUrl.startsWith("/") ? join(root, "public", imageUrl) : resolve(root, imageUrl);
  if (!existsSync(file)) throw new Error(`no file for ${imageUrl} (looked at ${file})`);
  if (statSync(file).size > MAX_SOURCE_BYTES) throw new Error(`${file} is over ${MAX_SOURCE_BYTES} bytes`);
  return new Uint8Array(readFileSync(file));
}

/** Every puzzle in the database, as the cutter needs it. */
export async function listPuzzles(db: AnyDb): Promise<CutPuzzle[]> {
  const rows = await db
    .select({ id: puzzles.id, imageUrl: puzzles.imageUrl, focusX: puzzles.focusX, focusY: puzzles.focusY, zoomLevels: puzzles.zoomLevels })
    .from(puzzles);
  return rows.map((r) => ({ id: r.id, imageUrl: r.imageUrl, reveal: { focus: { x: r.focusX, y: r.focusY }, zoomLevels: r.zoomLevels } }));
}

/**
 * Cut the puzzles that need it. `force` re-cuts current ones too; `only`
 * limits it to some ids; `skip` leaves some out (the practice pack, whose
 * public files the browser crops itself). One puzzle failing (a missing file,
 * a bad download) doesn't stop the others; it's in `failed`.
 */
export async function cutPuzzleImages(
  db: AnyDb,
  options: {
    root: string;
    force?: boolean;
    only?: readonly string[];
    skip?: ReadonlySet<string>;
    dryRun?: boolean;
    read?: (imageUrl: string) => Promise<Uint8Array>;
  },
): Promise<CutReport> {
  const read = options.read ?? ((url: string) => readSource(url, options.root));
  let list = (await listPuzzles(db)).filter((p) => !options.skip?.has(p.id));
  if (options.only && options.only.length > 0) {
    const unknown = options.only.filter((id) => !list.some((p) => p.id === id));
    if (unknown.length > 0) throw new Error(`no puzzle ${unknown.join(", ")} in the database (or it's skipped)`);
    list = list.filter((p) => options.only!.includes(p.id));
  }
  const current = await getCurrentLevelSrcs(db, list);
  const report: CutReport = { cut: [], current: [], failed: [] };
  for (const puzzle of list) {
    if (!options.force && current.has(puzzle.id)) {
      report.current.push(puzzle.id);
      continue;
    }
    if (options.dryRun) {
      report.cut.push(puzzle.id);
      continue;
    }
    try {
      const levels = await cutLevels(await read(puzzle.imageUrl), puzzle.reveal, { maxInputPixels: MAX_INPUT_PIXELS });
      await saveLevelImages(db, puzzle.id, levels, cutFingerprint(puzzle));
      report.cut.push(puzzle.id);
    } catch (error) {
      report.failed.push({ id: puzzle.id, problem: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}
