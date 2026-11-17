// Spec for storing per-level images (#57) on an empty in-memory Postgres
// (PGlite) with the real migrations: bytes come back unchanged, every level
// gets its own unguessable URL, and re-cutting a puzzle replaces its images.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getImageFile, getLevelSrcs, IMAGE_ID, saveLevelImages, type LevelImageInput } from "./images.ts";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeEach(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
  for (const id of ["pz-0a1b2c3d", "pz-9f8e7d6c"]) {
    await db.insert(schema.puzzles).values({
      id,
      answer: "Lemon",
      imageUrl: "/originals/x.jpg",
      focusX: 0.5,
      focusY: 0.5,
      zoomLevels: [4, 2, 1],
      creditSource: "Someone",
      creditLicense: "CC0",
    });
  }
}, 60_000);

afterEach(async () => {
  await pg.close();
});

/** Fake cut levels: distinct, non-text bytes per level (including 0x00 and 0xff). */
function levels(count: number, seed = 0): LevelImageInput[] {
  return Array.from({ length: count }, (_, level) => ({
    level,
    width: 100 * (level + 1),
    height: 75 * (level + 1),
    contentType: "image/webp" as const,
    bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, level, seed, ...Array.from({ length: 300 }, (_, i) => (i * 7 + level) % 256)]),
  }));
}

const idOf = (src: string) => /^\/img\/([0-9a-f]{32})\.webp$/.exec(src)?.[1];

describe("saveLevelImages", () => {
  it("stores every level and gives each its own /img/<random id>.webp URL", async () => {
    const stored = await saveLevelImages(db, "pz-0a1b2c3d", levels(3));
    expect(stored.map((s) => [s.level, s.width, s.height])).toEqual([
      [0, 100, 75],
      [1, 200, 150],
      [2, 300, 225],
    ]);
    const ids = stored.map((s) => idOf(s.src));
    for (const id of ids) expect(id).toMatch(IMAGE_ID);
    expect(new Set(ids).size).toBe(3);
  });

  it("gives URLs that say nothing about the puzzle, the level or the answer", async () => {
    const stored = await saveLevelImages(db, "pz-0a1b2c3d", levels(3));
    for (const { src } of stored) {
      expect(src).not.toContain("0a1b2c3d");
      expect(src.toLowerCase()).not.toContain("lemon");
      expect(src).not.toMatch(/level|lvl|-[0-9]\./);
    }
  });

  it("returns the exact bytes for each level", async () => {
    const input = levels(3);
    const stored = await saveLevelImages(db, "pz-0a1b2c3d", input);
    for (const [i, { src }] of stored.entries()) {
      const file = await getImageFile(db, idOf(src)!);
      expect(file?.contentType).toBe("image/webp");
      expect(Array.from(file!.bytes)).toEqual(Array.from(input[i]!.bytes));
    }
  });

  it("replaces an earlier cut: new URLs, and the old files are gone", async () => {
    const first = await saveLevelImages(db, "pz-0a1b2c3d", levels(3, 1));
    const second = await saveLevelImages(db, "pz-0a1b2c3d", levels(3, 2));
    for (const [i, { src }] of first.entries()) {
      expect(second[i]!.src).not.toBe(src);
      expect(await getImageFile(db, idOf(src)!)).toBeNull();
    }
    expect(await db.select().from(schema.imageFiles)).toHaveLength(3);
    expect((await getLevelSrcs(db, ["pz-0a1b2c3d"])).get("pz-0a1b2c3d")).toEqual(second.map((s) => s.src));
  });

  it("drops levels a puzzle no longer has", async () => {
    await saveLevelImages(db, "pz-0a1b2c3d", levels(3));
    // The content now has fewer zoom levels (re-seeded), then it's cut again.
    await db.update(schema.puzzles).set({ zoomLevels: [2, 1] }).where(eq(schema.puzzles.id, "pz-0a1b2c3d"));
    await saveLevelImages(db, "pz-0a1b2c3d", levels(2));
    const rows = await db.select().from(schema.puzzleImages).where(eq(schema.puzzleImages.puzzleId, "pz-0a1b2c3d"));
    expect(rows.map((r) => r.level).sort()).toEqual([0, 1]);
    expect(await db.select().from(schema.imageFiles)).toHaveLength(2);
  });

  it("leaves other puzzles' images alone", async () => {
    const other = await saveLevelImages(db, "pz-9f8e7d6c", levels(3));
    await saveLevelImages(db, "pz-0a1b2c3d", levels(3));
    await saveLevelImages(db, "pz-0a1b2c3d", levels(3, 5));
    for (const { src } of other) expect(await getImageFile(db, idOf(src)!)).not.toBeNull();
  });

  it("refuses levels that aren't 0..n-1 in order, or none at all", async () => {
    await expect(saveLevelImages(db, "pz-0a1b2c3d", [])).rejects.toThrow(/no levels/);
    await expect(saveLevelImages(db, "pz-0a1b2c3d", levels(3).reverse())).rejects.toThrow(/in order/);
  });

  it("refuses a cut with more or fewer images than the puzzle has zoom levels, writing nothing", async () => {
    // The puzzle has 3 zoom levels; the database can't check this itself (#82).
    for (const count of [2, 4]) {
      await expect(saveLevelImages(db, "pz-0a1b2c3d", levels(count))).rejects.toThrow(/has 3 zoom levels, but \d images/);
    }
    expect(await db.select().from(schema.imageFiles)).toHaveLength(0);
    expect(await db.select().from(schema.puzzleImages)).toHaveLength(0);
  });

  it("needs the puzzle to exist, and deletes its images with it", async () => {
    await expect(saveLevelImages(db, "pz-11111111", levels(3))).rejects.toThrow(/no puzzle "pz-11111111"/);
    await saveLevelImages(db, "pz-0a1b2c3d", levels(3));
    await db.delete(schema.puzzles).where(eq(schema.puzzles.id, "pz-0a1b2c3d"));
    expect(await db.select().from(schema.imageFiles)).toHaveLength(0);
    expect(await db.select().from(schema.puzzleImages)).toHaveLength(0);
  });
});

describe("getImageFile", () => {
  it("returns null for an unknown id, or anything that isn't an image id", async () => {
    expect(await getImageFile(db, "0".repeat(32))).toBeNull();
    for (const bad of ["", "abc", "0".repeat(31), "0".repeat(32).toUpperCase().replace(/0/g, "A"), "../etc/passwd", "' OR 1=1 --"]) {
      expect(await getImageFile(db, bad)).toBeNull();
    }
  });
});

describe("image_files", () => {
  it("only accepts random hex ids and WebP files", async () => {
    const row = { puzzleId: "pz-0a1b2c3d", bytes: new Uint8Array([1]), width: 1, height: 1 };
    await expect(db.insert(schema.imageFiles).values({ ...row, id: "pz-0a1b2c3d-level-0", contentType: "image/webp" })).rejects.toThrow();
    await expect(db.insert(schema.imageFiles).values({ ...row, id: "a".repeat(32), contentType: "text/html" })).rejects.toThrow();
  });
});

describe("getLevelSrcs", () => {
  it("lists each puzzle's URLs by level, and skips puzzles with no images", async () => {
    const a = await saveLevelImages(db, "pz-0a1b2c3d", levels(3));
    const srcs = await getLevelSrcs(db, ["pz-0a1b2c3d", "pz-9f8e7d6c"]);
    expect(srcs.get("pz-0a1b2c3d")).toEqual(a.map((s) => s.src));
    expect(srcs.has("pz-9f8e7d6c")).toBe(false);
    expect(await getLevelSrcs(db, [])).toEqual(new Map());
  });
});
