// Spec for Beat the AI's solver (#56, by solve time #257): it watches each
// puzzle's effect clear up on its stored photo, and writes aiSolvedSeconds
// into the content files and the database so a re-seed keeps it. Runs against
// PGlite with the real migrations; a fake classifier stands in for CLIP and
// "sees" red as the answer.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedContent } from "../src/db/content.ts";
import { saveLevelImages, type LevelImageInput } from "../src/db/images.ts";
import * as schema from "../src/db/schema.ts";
import { parseContent, type Content } from "../src/game/packs.ts";
import type { Pack, Puzzle, PuzzleEffect } from "../src/game/types.ts";
import type { Classifier } from "../src/images/clip/analyze.ts";
import { rank } from "../src/images/clip/decide.ts";
import type { ClipModel, RgbImage } from "../src/images/clip/model.ts";
import {
  answersByPuzzle,
  cachedTexts,
  formatJson,
  saveAiSolvedSeconds,
  setAiSolvedSeconds,
  solvePuzzles,
  storedPhotos,
} from "./ai-solver.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function puzzle(id: string, answer: string, effect: PuzzleEffect = "tiles"): Puzzle {
  return {
    id,
    imageUrl: `images/${id}.jpg`,
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "test", license: "CC0" },
    aiSolvedLevel: null,
    effect,
  };
}
const pack = (id: string, puzzleIds: string[]): Pack => ({ id, kind: "daily", title: "Test", theme: "Test", puzzleIds });

const RED = { r: 220, g: 20, b: 20 };
const GREEN = { r: 20, g: 180, b: 20 };
const webp = async (colour: typeof RED): Promise<LevelImageInput> => ({
  level: 0,
  width: 40,
  height: 30,
  contentType: "image/webp",
  bytes: new Uint8Array(await sharp({ create: { width: 40, height: 30, channels: 3, background: colour } }).webp().toBuffer()),
});
/** Stores one image per level: the whole photo (the last level) in `photo`, the closer levels green. */
async function storeLevels(db: PgliteDatabase<typeof schema>, p: Puzzle, photo: typeof RED) {
  const last = p.reveal.zoomLevels.length - 1;
  const levels = await Promise.all(p.reveal.zoomLevels.map(async (_, level) => ({ ...(await webp(level === last ? photo : GREEN)), level })));
  await saveLevelImages(db, p.id, levels);
}
/** A short clock for the database tests: a frame each second for 4 s. */
const FAST = { revealSeconds: 4, step: 1 };

const red = ({ data }: RgbImage) => {
  let n = 0;
  for (let i = 0; i < data.length; i += 3) if (data[i]! > 150 && data[i + 1]! < 90) n++;
  return n / (data.length / 3);
};
/** CLIP, faked: a mostly red view is the first label (the puzzle's own answer), anything else is grass. */
const fakeClassifier = async (labels: string[]): Promise<Classifier> => ({
  labels,
  classify: async (images) => images.map((image) => (red(image) > 0.3 ? rank([labels[0]!, "grass"], [0.3, 0.2]) : rank(["grass", labels[0]!], [0.3, 0.2]))),
});

describe("answersByPuzzle", () => {
  it("gives each puzzle its own answer, then its pack's", () => {
    const content = { puzzles: [puzzle("a", "Fig"), puzzle("b", "Date"), puzzle("c", "Kiwi")], packs: [pack("p1", ["a", "b"])] };
    const answers = answersByPuzzle(content);
    expect(answers.get("a")).toEqual(["Fig", "Fig", "Date"]);
    expect(answers.get("b")).toEqual(["Date", "Fig", "Date"]);
    expect(answers.get("c")).toEqual(["Kiwi"]); // in no pack
  });

  it("includes every pack a puzzle is in", () => {
    const content = { puzzles: [puzzle("a", "Fig"), puzzle("b", "Date"), puzzle("c", "Kiwi")], packs: [pack("p1", ["a", "b"]), pack("p2", ["a", "c"])] };
    expect(answersByPuzzle(content).get("a")).toEqual(["Fig", "Fig", "Date", "Fig", "Kiwi"]);
  });
});

describe("cachedTexts", () => {
  it("runs each text through the model once, however often it's asked for", async () => {
    const embedTexts = vi.fn(async (texts: readonly string[]) => texts.map((t) => Float32Array.from([t.length])));
    const model = cachedTexts({ name: "fake", embedTexts, embedImages: async () => [] } satisfies ClipModel);
    const first = await model.embedTexts(["grass", "fig", "grass"]);
    const second = await model.embedTexts(["fig", "kiwi"]);
    expect(embedTexts.mock.calls.map(([texts]) => texts)).toEqual([["grass", "fig"], ["kiwi"]]);
    expect([...first, ...second].map((v) => v[0])).toEqual([5, 3, 5, 3, 4]);
  });
});

describe("formatJson", () => {
  it("writes the committed practice files back exactly as they are", () => {
    for (const file of ["src/puzzles/sample.json", "src/puzzles/practice-pack.json"]) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      expect(formatJson(JSON.parse(text)), file).toBe(text);
    }
  });

  it("keeps a short list or object of plain values on one line, and breaks long or nested ones", () => {
    const long = "x".repeat(90);
    expect(formatJson({ a: [1, 2], b: { x: 0.5 }, c: [], d: {}, e: [{ f: 1 }], g: [long] })).toBe(
      `{\n  "a": [1, 2],\n  "b": { "x": 0.5 },\n  "c": [],\n  "d": {},\n  "e": [\n    { "f": 1 }\n  ],\n  "g": [\n    "${long}"\n  ]\n}\n`,
    );
  });
});

describe("setAiSolvedSeconds", () => {
  it("sets the time on puzzles in a list of puzzles, like sample.json", () => {
    const json = [{ id: "a" }, { id: "b", aiSolvedSeconds: 1.5 }, { id: "c" }];
    expect(setAiSolvedSeconds(json, new Map([["a", 6.5], ["b", 1.5], ["x", 0]]))).toEqual(["a"]);
    expect(json).toEqual([{ id: "a", aiSolvedSeconds: 6.5 }, { id: "b", aiSolvedSeconds: 1.5 }, { id: "c" }]);
  });

  it("writes never as null, so the file shows the solver ran, and leaves other puzzles and fields alone", () => {
    const json = { packs: [{ id: "p" }], puzzles: [{ id: "a", aiSolvedSeconds: 3, aiSolvedLevel: 1 }, { id: "b" }, { id: "c", aiSolvedSeconds: null }] };
    expect(setAiSolvedSeconds(json, new Map([["a", null], ["b", null], ["c", null]]))).toEqual(["a", "b"]);
    expect(json).toEqual({
      packs: [{ id: "p" }],
      puzzles: [{ id: "a", aiSolvedSeconds: null, aiSolvedLevel: 1 }, { id: "b", aiSolvedSeconds: null }, { id: "c", aiSolvedSeconds: null }],
    });
  });

  it("changes nothing in a file with no puzzles", () => {
    const json = { packs: [] };
    expect(setAiSolvedSeconds(json, new Map([["a", 1]]))).toEqual([]);
    expect(json).toEqual({ packs: [] });
  });
});

describe("with a database", { timeout: 30_000 }, () => {
  let pg: PGlite;
  let db: PgliteDatabase<typeof schema>;

  // A fresh database per test; starting PGlite and migrating can be slow under a full test run.
  beforeEach(async () => {
    pg = new PGlite();
    db = drizzle({ client: pg, schema });
    await migrate(db, { migrationsFolder });
  }, 60_000);
  afterEach(async () => {
    await pg.close();
  });

  const storedSeconds = async (id: string) =>
    (await db.select({ seconds: schema.puzzles.aiSolvedSeconds }).from(schema.puzzles).where(eq(schema.puzzles.id, id)))[0]!.seconds;

  describe("storedPhotos", () => {
    it("reads each puzzle's whole stored photo, its last level, which is what the game shows", async () => {
      const p = puzzle("pz-a", "Fig");
      await seedContent(db, { puzzles: [p], packs: [], schedule: [] });
      await storeLevels(db, p, RED);
      const photo = (await storedPhotos(db, [p])).get("pz-a")!;
      expect((await sharp(photo).raw().toBuffer())[0]).toBeGreaterThan(150);
    });

    it("names every puzzle that isn't seeded, isn't fully cut, or changed since it was cut", async () => {
      const [cut, uncut, moved, absent] = [puzzle("pz-cut", "Fig"), puzzle("pz-uncut", "Date"), puzzle("pz-moved", "Kiwi"), puzzle("pz-absent", "Lime")];
      await seedContent(db, { puzzles: [cut, uncut, moved], packs: [], schedule: [] });
      await storeLevels(db, cut, RED);
      await storeLevels(db, moved, RED);
      const movedNow = { ...moved, reveal: { ...moved.reveal, focus: { x: 0.2, y: 0.5 } } };
      const error = await storedPhotos(db, [cut, uncut, movedNow, absent]).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(/npm run db:seed/);
      expect(message).toMatch(/pz-uncut: its level images aren't all cut/);
      expect(message).toMatch(/pz-moved: its image, focus or zoom levels changed/);
      expect(message).toMatch(/pz-absent: not in the database/);
      expect(message).not.toMatch(/pz-cut/);
      expect(message).not.toMatch(/Fig|Date|Kiwi|Lime/); // ids only, never answers
    });
  });

  describe("solvePuzzles", () => {
    it("gives each puzzle the first time CLIP gets it while its effect plays, or null", async () => {
      // Pixelated red is still red (solved at once); tiles start shut; grass is never the answer.
      const puzzles = [puzzle("pz-a", "Fig", "pixelate"), puzzle("pz-b", "Date", "tiles"), puzzle("pz-c", "Kiwi", "tiles")];
      await seedContent(db, { puzzles, packs: [pack("pk-1", ["pz-a", "pz-b", "pz-c"])], schedule: [] });
      await storeLevels(db, puzzles[0]!, RED);
      await storeLevels(db, puzzles[1]!, RED);
      await storeLevels(db, puzzles[2]!, GREEN);
      const content = { puzzles, packs: [pack("pk-1", ["pz-a", "pz-b", "pz-c"])] };
      const solved = await solvePuzzles(db, content, fakeClassifier, FAST);
      expect(solved.get("pz-a")!.aiSolvedSeconds).toBe(0);
      const tiles = solved.get("pz-b")!;
      expect(tiles.aiSolvedSeconds).toBeGreaterThan(0);
      expect(tiles.aiSolvedSeconds).toBeLessThanOrEqual(FAST.revealSeconds);
      expect(tiles.steps.find((s) => s.solved)!.seconds).toBe(tiles.aiSolvedSeconds);
      expect(solved.get("pz-c")!.aiSolvedSeconds).toBeNull();
      expect(solved.get("pz-c")!.steps.map((s) => s.seconds)).toEqual([0, 1, 2, 3, 4]);
    });

    it("chooses between the pack's answers and the generic list, one classifier per set of labels", async () => {
      const puzzles = [puzzle("pz-a", "Fig"), puzzle("pz-b", "Date"), puzzle("pz-c", "Kiwi")];
      await seedContent(db, { puzzles, packs: [], schedule: [] });
      for (const p of puzzles) await storeLevels(db, p, RED);
      const classifierFor = vi.fn(fakeClassifier);
      await solvePuzzles(db, { puzzles, packs: [pack("pk-1", ["pz-a", "pz-b"])] }, classifierFor, FAST);
      const labelSets = classifierFor.mock.calls.map(([labels]) => labels);
      expect(labelSets).toHaveLength(3); // a and b each put their own answer first; c is in no pack
      expect(labelSets[0]!.slice(0, 2)).toEqual(["Fig", "Date"]);
      expect(labelSets[1]!.slice(0, 2)).toEqual(["Date", "Fig"]);
      expect(labelSets[2]![0]).toBe("Kiwi");
      expect(labelSets[2]).not.toContain("Fig");
      expect(labelSets[0]!.length).toBeGreaterThan(500); // plus the generic list
    });
  });

  describe("saveAiSolvedSeconds", () => {
    it("writes only the times that changed, and returns those ids", async () => {
      const puzzles = [puzzle("pz-a", "Fig"), puzzle("pz-b", "Date")];
      await seedContent(db, { puzzles: [puzzles[0]!, { ...puzzles[1]!, aiSolvedSeconds: 2.5 }], packs: [], schedule: [] });
      expect(await saveAiSolvedSeconds(db, new Map([["pz-a", 6.5], ["pz-b", 2.5], ["pz-unknown", 0]]))).toEqual(["pz-a"]);
      expect([await storedSeconds("pz-a"), await storedSeconds("pz-b")]).toEqual([6.5, 2.5]);
      expect(await saveAiSolvedSeconds(db, new Map([["pz-a", 6.5]]))).toEqual([]);
      expect(await saveAiSolvedSeconds(db, new Map([["pz-b", null]]))).toEqual(["pz-b"]);
      expect(await storedSeconds("pz-b")).toBeNull();
      expect(await saveAiSolvedSeconds(db, new Map([["pz-b", null]]))).toEqual([]);
    });

    it("refuses a negative time (the database checks it)", async () => {
      await seedContent(db, { puzzles: [puzzle("pz-a", "Fig")], packs: [], schedule: [] });
      await expect(saveAiSolvedSeconds(db, new Map([["pz-a", -1]]))).rejects.toThrow();
    });
  });

  it("solve times survive a re-seed, because the content file has them too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zoom-out-solver-"));
    try {
      const file = join(dir, "day.json");
      const p = puzzle("pz-a", "Fig");
      const original: Content = { packs: [pack("pk-1", ["pz-a"])], puzzles: [p], schedule: [] };
      writeFileSync(file, formatJson(original));
      await seedContent(db, parseContent(JSON.parse(readFileSync(file, "utf8"))));
      await storeLevels(db, p, RED);

      // What the command does: solve, write the file, then the database.
      const solved = await solvePuzzles(db, original, fakeClassifier, FAST);
      const times = new Map([...solved].map(([id, s]) => [id, s.aiSolvedSeconds]));
      const seconds = times.get("pz-a")!;
      expect(seconds).toBeGreaterThan(0);
      const json = JSON.parse(readFileSync(file, "utf8"));
      setAiSolvedSeconds(json, times);
      writeFileSync(file, formatJson(json));
      await saveAiSolvedSeconds(db, times);
      expect(await storedSeconds("pz-a")).toBe(seconds);

      await seedContent(db, parseContent(JSON.parse(readFileSync(file, "utf8"))));
      expect(await storedSeconds("pz-a")).toBe(seconds);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("npm run db:solve-ai", { timeout: 30_000 }, () => {
  // No database URL, even if .env.local has one: an empty value wins, so these
  // stop before connecting to anything.
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["scripts/solve-ai.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL_UNPOOLED: "", INIT_CWD: repoRoot },
    });

  it("fails on a path that doesn't exist", () => {
    const result = run("no/such/content.json");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no\/such\/content\.json: no such file or folder/);
  });

  it("refuses private content anywhere in the repo that git would commit, since it writes into it", () => {
    const dir = mkdtempSync(join(repoRoot, "solver-test-"));
    try {
      const file = join(dir, "day.json");
      writeFileSync(file, formatJson({ puzzles: [puzzle("pz-a", "Fig")] }));
      const result = run(file);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/inside the repo and not git-ignored, so git could commit it/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks the content, then needs a database", () => {
    const dir = mkdtempSync(join(tmpdir(), "zoom-out-solver-"));
    try {
      mkdirSync(join(dir, "content"));
      writeFileSync(join(dir, "content", "day.json"), formatJson({ puzzles: [puzzle("pz-a", "Fig")] }));
      const result = run(join(dir, "content"));
      expect(result.stdout).toMatch(/4 puzzles in 1 content file\(s\) plus the practice pack/);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/DATABASE_URL_UNPOOLED is not set/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
