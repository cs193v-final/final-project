// Spec for cutting seeded puzzles into level images (#57): what gets cut, what
// is skipped, and where originals are found. Runs against PGlite with the real
// migrations, and cuts real (generated) photos with sharp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { seedContent } from "../src/db/content.ts";
import { getLevelSrcs } from "../src/db/images.ts";
import * as schema from "../src/db/schema.ts";
import type { Puzzle } from "../src/game/types.ts";
import { cutPuzzleImages, originalPath, storedImageSettings } from "./seed-images.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
let dir: string;

function puzzle(id: string, zoomLevels: number[], focus = { x: 0.5, y: 0.5 }): Puzzle {
  return {
    id,
    imageUrl: `images/${id}.jpg`,
    answer: "Lemon",
    acceptedAnswers: [],
    reveal: { focus, zoomLevels },
    credit: { source: "test", license: "CC0" },
    aiSolvedLevel: null,
  };
}

const content = (puzzles: Puzzle[]) => ({ puzzles, packs: [], schedule: [] });
const originalOf = (p: Puzzle) => originalPath(p, dir, repoRoot);

/** Seed `puzzles` and cut their images, as `npm run db:seed` does. */
async function seedAndCut(puzzles: Puzzle[], options: { recut?: boolean } = {}) {
  const before = await storedImageSettings(db, puzzles.map((p) => p.id));
  await seedContent(db, content(puzzles));
  return cutPuzzleImages(db, puzzles, originalOf, { before, ...options });
}

beforeEach(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
  dir = mkdtempSync(join(tmpdir(), "seed-images-"));
  mkdirSync(join(dir, "images"));
  for (const id of ["pz-0a1b2c3d", "pz-9f8e7d6c"]) {
    const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 220, g: 200, b: 30 } } }).jpeg().toBuffer();
    writeFileSync(join(dir, "images", `${id}.jpg`), photo);
  }
}, 60_000);

afterEach(async () => {
  await pg.close();
  rmSync(dir, { recursive: true, force: true });
});

const A = puzzle("pz-0a1b2c3d", [4, 2, 1]);
const B = puzzle("pz-9f8e7d6c", [8, 4, 2, 1]);

describe("cutPuzzleImages", () => {
  it("cuts each seeded puzzle into one stored image per zoom level", async () => {
    expect(await seedAndCut([A, B])).toEqual({ cut: 2, alreadyCut: 0 });
    const srcs = await getLevelSrcs(db, [A.id, B.id]);
    expect(srcs.get(A.id)).toHaveLength(3);
    expect(srcs.get(B.id)).toHaveLength(4);
    for (const src of [...srcs.values()].flat()) expect(src).toMatch(/^\/img\/[0-9a-f]{32}\.webp$/u);
  });

  it("skips puzzles that are already cut with the same image, focus and zoom levels", async () => {
    await seedAndCut([A, B]);
    const first = await getLevelSrcs(db, [A.id, B.id]);
    expect(await seedAndCut([A, B])).toEqual({ cut: 0, alreadyCut: 2 });
    expect(await getLevelSrcs(db, [A.id, B.id])).toEqual(first);
  });

  it("cuts a puzzle again when its focus point or zoom levels change, and only that one", async () => {
    await seedAndCut([A, B]);
    const first = await getLevelSrcs(db, [A.id, B.id]);
    const moved = { ...A, reveal: { ...A.reveal, focus: { x: 0.25, y: 0.75 } } };
    expect(await seedAndCut([moved, B])).toEqual({ cut: 1, alreadyCut: 1 });
    const after = await getLevelSrcs(db, [A.id, B.id]);
    expect(after.get(A.id)).not.toEqual(first.get(A.id));
    expect(after.get(B.id)).toEqual(first.get(B.id));

    const sameLevelCount = { ...B, reveal: { ...B.reveal, zoomLevels: [10, 5, 2.5, 1] } };
    expect(await seedAndCut([moved, sameLevelCount])).toEqual({ cut: 1, alreadyCut: 1 });
  });

  it("cuts everything again with recut, giving every level a new URL", async () => {
    await seedAndCut([A, B]);
    const first = await getLevelSrcs(db, [A.id, B.id]);
    expect(await seedAndCut([A, B], { recut: true })).toEqual({ cut: 2, alreadyCut: 0 });
    const after = await getLevelSrcs(db, [A.id, B.id]);
    for (const id of [A.id, B.id]) {
      for (const src of after.get(id)!) expect(first.get(id)).not.toContain(src);
    }
  });
});

describe("originalPath", () => {
  it("finds a practice image in public/, and a content image next to its content file", () => {
    expect(originalPath({ id: "pz-1", imageUrl: "/puzzles/pz-dbdb4dee.jpg" }, null, repoRoot)).toBe(
      join(repoRoot, "public", "puzzles", "pz-dbdb4dee.jpg"),
    );
    expect(originalPath(A, dir, repoRoot)).toBe(join(dir, "images", "pz-0a1b2c3d.jpg"));
  });

  it("refuses a remote URL, since only a local original can be cut", () => {
    expect(() => originalPath({ id: "pz-1", imageUrl: "https://images.example.com/x.jpg" }, dir, repoRoot)).toThrow(
      /puzzle pz-1: imageUrl "https:\/\/images.example.com\/x.jpg" is a remote URL/u,
    );
    // Protocol-relative URLs are remote too, not a path under public/.
    expect(() => originalPath({ id: "pz-1", imageUrl: "//cdn.example.com/x.jpg" }, dir, repoRoot)).toThrow(/is a remote URL/u);
  });

  it("treats a Windows drive path as a local file, not a URL", () => {
    // On Linux it's just a missing file; what matters is that it isn't called remote.
    expect(() => originalPath({ id: "pz-1", imageUrl: "C:\\photos\\fig.jpg" }, dir, repoRoot)).toThrow(/no original image at /u);
  });

  it("names the puzzle when its original is missing", () => {
    expect(() => originalPath({ id: "pz-1", imageUrl: "images/missing.jpg" }, dir, repoRoot)).toThrow(/puzzle pz-1: no original image at /u);
  });
});
