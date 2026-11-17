// Spec for the cut command (#57 follow-up): cuts what needs cutting, skips
// what's current, re-cuts a puzzle whose image or crop changed, and the game's
// puzzle source only ever uses complete, current cuts. PGlite with the real
// migrations, and the real practice photos (re-used under other ids as
// stand-ins for private puzzles).
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getPuzzles, seedContent } from "../src/db/content.ts";
import * as schema from "../src/db/schema.ts";
import { combineContent } from "../src/game/packs.ts";
import type { Pack, Puzzle } from "../src/game/types.ts";
import { cutPuzzleImages, readSource } from "./cut-images-core.ts";

const root = resolve(import.meta.dirname, "..");
const migrationsFolder = join(root, "drizzle");

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

// Practice photos under new ids, as if they were private daily puzzles.
const puzzle = (id: string, file: string, zoomLevels = [8, 4, 2, 1]): Puzzle => ({
  id,
  imageUrl: `/puzzles/${file}.jpg`,
  answer: "Something",
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels },
  credit: { source: "Someone", license: "CC BY-SA 4.0" },
  aiSolvedLevel: null,
});
const A = puzzle("pz-c1", "pz-dbdb4dee");
const B = puzzle("pz-c2", "pz-683182e7", [10, 5, 2.5, 1]);
const PACK: Pack = { id: "pk-c", kind: "daily", title: "Mixed", theme: "Mixed", puzzleIds: ["pz-c1", "pz-c2"] };

const seed = (puzzles: Puzzle[]) =>
  seedContent(db, combineContent([{ source: "test", content: { puzzles, packs: [PACK], schedule: [] } }]));
const count = async (table: string) => Number((await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n);

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
}, 60_000);

beforeEach(async () => {
  await pg.exec("TRUNCATE image_files, puzzle_images, pack_puzzles, puzzles, packs CASCADE");
  await seed([A, B]);
});

afterAll(async () => {
  await pg.close();
});

describe("cutPuzzleImages", () => {
  it("a dry run lists what would be cut and writes nothing", async () => {
    const report = await cutPuzzleImages(db, { root, dryRun: true });
    expect(report).toEqual({ cut: ["pz-c1", "pz-c2"], current: [], failed: [] });
    expect(await count("image_files")).toBe(0);
  });

  it("cuts one image per zoom level, and the game's puzzle source then uses them", async () => {
    const report = await cutPuzzleImages(db, { root });
    expect(report.cut.sort()).toEqual(["pz-c1", "pz-c2"]);
    expect(await count("image_files")).toBe(8);
    const [a, b] = await getPuzzles(db, ["pz-c1", "pz-c2"]);
    expect(a!.levelImages).toHaveLength(4);
    expect(b!.levelImages).toHaveLength(4);
    for (const src of [...a!.levelImages!, ...b!.levelImages!]) expect(src).toMatch(/^\/img\/[0-9a-f]{32}\.webp$/u);
  }, 60_000);

  it("is safe to run again: current cuts are left alone", async () => {
    await cutPuzzleImages(db, { root });
    const before = (await getPuzzles(db, ["pz-c1"]))[0]!.levelImages;
    expect(await cutPuzzleImages(db, { root })).toEqual({ cut: [], current: ["pz-c1", "pz-c2"], failed: [] });
    expect((await getPuzzles(db, ["pz-c1"]))[0]!.levelImages).toEqual(before);
  }, 60_000);

  it("treats cuts as stale once the puzzle's focus changes, and re-cuts only that puzzle", async () => {
    await cutPuzzleImages(db, { root });
    await seed([{ ...A, reveal: { ...A.reveal, focus: { x: 0.3, y: 0.7 } } }, B]); // a "fix" the seed allows
    expect((await getPuzzles(db, ["pz-c1"]))[0]!.levelImages).toBeUndefined(); // never the old crop
    expect((await getPuzzles(db, ["pz-c2"]))[0]!.levelImages).toHaveLength(4);
    const report = await cutPuzzleImages(db, { root });
    expect(report.cut).toEqual(["pz-c1"]);
    expect((await getPuzzles(db, ["pz-c1"]))[0]!.levelImages).toHaveLength(4);
  }, 60_000);

  it("treats cuts as stale when the number of zoom levels changes (before anyone played it)", async () => {
    await cutPuzzleImages(db, { root });
    await seed([{ ...A, reveal: { ...A.reveal, zoomLevels: [12, 6, 3, 1.5, 1] } }, B]);
    expect((await getPuzzles(db, ["pz-c1"]))[0]!.levelImages).toBeUndefined();
    await cutPuzzleImages(db, { root });
    expect((await getPuzzles(db, ["pz-c1"]))[0]!.levelImages).toHaveLength(5);
  }, 60_000);

  it("re-cuts current puzzles with force, giving every level a fresh URL", async () => {
    await cutPuzzleImages(db, { root });
    const before = (await getPuzzles(db, ["pz-c1"]))[0]!.levelImages!;
    expect((await cutPuzzleImages(db, { root, force: true, only: ["pz-c1"] })).cut).toEqual(["pz-c1"]);
    const after = (await getPuzzles(db, ["pz-c1"]))[0]!.levelImages!;
    expect(after.some((src) => before.includes(src))).toBe(false);
    expect(await count("image_files")).toBe(8); // the old files are deleted
  }, 60_000);

  it("skips the puzzles it's told to (the practice pack), and refuses an unknown id", async () => {
    expect((await cutPuzzleImages(db, { root, dryRun: true, skip: new Set(["pz-c2"]) })).cut).toEqual(["pz-c1"]);
    await expect(cutPuzzleImages(db, { root, only: ["pz-nope"] })).rejects.toThrow("no puzzle pz-nope");
  });

  it("reports a puzzle it can't read and still cuts the others", async () => {
    await seed([{ ...A, imageUrl: "/puzzles/pz-missing.jpg" }, B]);
    const report = await cutPuzzleImages(db, { root });
    expect(report.cut).toEqual(["pz-c2"]);
    expect(report.failed).toEqual([{ id: "pz-c1", problem: expect.stringContaining("no file for /puzzles/pz-missing.jpg") }]);
  }, 60_000);

  it("never trusts cuts stored without a fingerprint (made before fingerprints existed)", async () => {
    await cutPuzzleImages(db, { root });
    await pg.query("UPDATE puzzle_images SET cut_from = NULL WHERE puzzle_id = 'pz-c1'");
    expect((await getPuzzles(db, ["pz-c1"]))[0]!.levelImages).toBeUndefined();
  }, 60_000);
});

describe("readSource", () => {
  it("reads /… from public/ and other paths from the repo root (e.g. content/)", async () => {
    expect((await readSource("/puzzles/pz-dbdb4dee.jpg", root)).byteLength).toBeGreaterThan(1000);
    const dir = mkdtempSync(join(tmpdir(), "cut-src-"));
    try {
      mkdirSync(join(dir, "content", "images"), { recursive: true });
      writeFileSync(join(dir, "content", "images", "pz-x.jpg"), "bytes");
      expect(new TextDecoder().decode(await readSource("content/images/pz-x.jpg", dir))).toBe("bytes");
      await expect(readSource("content/images/pz-none.jpg", dir)).rejects.toThrow("no file for content/images/pz-none.jpg");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
