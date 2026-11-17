// Spec for the seed script's database side (#52): content goes in, comes back
// out unchanged, seeding again is safe, and nothing players already played
// gets changed. Runs on an empty in-memory Postgres (PGlite) with the real
// migrations, like schema.test.ts.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { combineContent, type Content } from "../game/packs.ts";
import type { Pack, Puzzle } from "../game/types.ts";
import { PRACTICE_CONTENT, PRACTICE_PACK, SAMPLE_PUZZLES } from "../puzzles/index.ts";
import { getDailyEntry, getPack, getPuzzles, SeedRefusedError, seedContent } from "./content.ts";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeEach(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
}, 60_000);

afterEach(async () => {
  await pg.close();
});

function puzzle(id: string, answer: string, extra: Partial<Puzzle> = {}): Puzzle {
  return {
    id,
    imageUrl: `https://images.example.com/${id}.jpg`,
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.25, y: 0.75 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "Someone", license: "CC0" },
    aiSolvedLevel: null,
    ...extra,
  };
}

const daily = (id: string, puzzleIds: string[]): Pack => ({ id, kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds });

function content(parts: Partial<Content>): Content {
  return combineContent([{ source: "test", content: { packs: [], puzzles: [], schedule: [], ...parts } }]);
}

const FRUIT = [puzzle("pz-1", "Strawberry", { acceptedAnswers: ["Strawberries"], aiSolvedLevel: 2 }), puzzle("pz-2", "Pineapple")];
const FRUIT_DAY = content({
  puzzles: FRUIT,
  packs: [daily("pk-1", ["pz-1", "pz-2"])],
  schedule: [{ date: "2026-11-20", packId: "pk-1" }],
});

async function addGame(packId: string) {
  await pg.query("INSERT INTO games (pack_id, state) VALUES ($1, '{}')", [packId]);
}

describe("seedContent", () => {
  it("loads the practice pack, and reads it back exactly as it is in the repo", async () => {
    await seedContent(db, PRACTICE_CONTENT);
    expect(await getPack(db, PRACTICE_PACK.id)).toEqual(PRACTICE_PACK);
    expect(await getPuzzles(db, PRACTICE_PACK.puzzleIds)).toEqual(SAMPLE_PUZZLES);
  });

  it("loads a daily pack with its schedule, alternates and AI level", async () => {
    expect(await seedContent(db, FRUIT_DAY)).toEqual({ puzzles: 2, packs: 1, packOrders: 1, schedule: 1 });
    expect(await getPuzzles(db, ["pz-2", "pz-1"])).toEqual([FRUIT[1], FRUIT[0]]);
    expect(await getDailyEntry(db, "2026-11-20")).toEqual({ date: "2026-11-20", packId: "pk-1" });
    expect(await getDailyEntry(db, "2026-11-21")).toBeNull();
  });

  it("is safe to run again: same rows, and an unchanged pack's puzzle list isn't rewritten", async () => {
    await seedContent(db, FRUIT_DAY);
    expect(await seedContent(db, FRUIT_DAY)).toEqual({ puzzles: 2, packs: 1, packOrders: 0, schedule: 1 });
    const counts = await pg.query<{ n: number }>(
      "SELECT (SELECT count(*) FROM puzzles) + (SELECT count(*) FROM packs) + (SELECT count(*) FROM pack_puzzles) + (SELECT count(*) FROM daily_schedule) AS n",
    );
    expect(Number(counts.rows[0]!.n)).toBe(2 + 1 + 2 + 1);
  });

  it("updates puzzles and pack details in place, e.g. to fix a typo", async () => {
    await seedContent(db, FRUIT_DAY);
    await addGame("pk-1"); // fixing a typo is fine even after people played
    const fixedPuzzle = { ...FRUIT[0]!, answer: "Strawberry!", credit: { source: "Fixed", license: "CC BY 4.0", url: "https://x.example" } };
    await seedContent(db, content({ puzzles: [fixedPuzzle, FRUIT[1]!], packs: [{ ...daily("pk-1", ["pz-1", "pz-2"]), title: "Fruits" }] }));
    expect((await getPuzzles(db, ["pz-1"]))[0]).toMatchObject({ answer: "Strawberry!", credit: { source: "Fixed", url: "https://x.example" } });
    expect(await getPack(db, "pk-1")).toMatchObject({ title: "Fruits", puzzleIds: ["pz-1", "pz-2"] });
  });

  it("reorders a pack nobody has played yet", async () => {
    await seedContent(db, FRUIT_DAY);
    await seedContent(db, content({ puzzles: FRUIT, packs: [daily("pk-1", ["pz-2", "pz-1"])] }));
    expect((await getPack(db, "pk-1"))!.puzzleIds).toEqual(["pz-2", "pz-1"]);
  });

  it("fills in a pack that has games but no puzzle list yet (#54 creates the practice row on first play)", async () => {
    await pg.query("INSERT INTO packs (id, kind, title, theme) VALUES ($1, 'practice', 'Practice', 'Mixed')", [PRACTICE_PACK.id]);
    await addGame(PRACTICE_PACK.id);
    await seedContent(db, PRACTICE_CONTENT);
    expect((await getPack(db, PRACTICE_PACK.id))!.puzzleIds).toEqual(PRACTICE_PACK.puzzleIds);
  });

  it("refuses to change the puzzles of a pack people have played, and writes nothing", async () => {
    await seedContent(db, FRUIT_DAY);
    await addGame("pk-1");
    const changed = content({
      puzzles: [...FRUIT, puzzle("pz-3", "Mango")],
      packs: [daily("pk-1", ["pz-1", "pz-3"])],
    });
    const error = await seedContent(db, changed).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeedRefusedError);
    expect((error as SeedRefusedError).problems).toEqual(["pack pk-1: its puzzle list changed, but it has already been played"]);
    expect(await getPuzzles(db, ["pz-3"]).catch(() => "missing")).toBe("missing");
    expect((await getPack(db, "pk-1"))!.puzzleIds).toEqual(["pz-1", "pz-2"]);
  });

  it("moves a day to another pack only if the old one hasn't been played", async () => {
    await seedContent(db, FRUIT_DAY);
    const moved = content({
      puzzles: [puzzle("pz-3", "Mango")],
      packs: [daily("pk-2", ["pz-3"])],
      schedule: [{ date: "2026-11-20", packId: "pk-2" }],
    });
    await seedContent(db, moved);
    expect((await getDailyEntry(db, "2026-11-20"))!.packId).toBe("pk-2");

    await addGame("pk-2");
    const back = content({ puzzles: FRUIT, packs: [daily("pk-1", ["pz-1", "pz-2"])], schedule: [{ date: "2026-11-20", packId: "pk-1" }] });
    await expect(seedContent(db, back)).rejects.toThrow("schedule 2026-11-20: moves away from pack pk-2");
    expect((await getDailyEntry(db, "2026-11-20"))!.packId).toBe("pk-2");
  });

  it("never deletes: content left out of a run stays in the database", async () => {
    await seedContent(db, FRUIT_DAY);
    await seedContent(db, PRACTICE_CONTENT);
    expect(await getPack(db, "pk-1")).not.toBeNull();
    expect(await getDailyEntry(db, "2026-11-20")).not.toBeNull();
  });
});

describe("reading content", () => {
  it("getPuzzles keeps the order asked for and throws on a missing id", async () => {
    await seedContent(db, FRUIT_DAY);
    expect((await getPuzzles(db, ["pz-2", "pz-1"])).map((p) => p.id)).toEqual(["pz-2", "pz-1"]);
    expect(await getPuzzles(db, [])).toEqual([]);
    await expect(getPuzzles(db, ["pz-1", "pz-9"])).rejects.toThrow('no puzzle "pz-9"');
  });

  it("getPack returns null for an unknown pack", async () => {
    expect(await getPack(db, "pk-9")).toBeNull();
  });

  it("getDailyEntry ignores a schedule row that points at a pack that isn't daily", async () => {
    await seedContent(db, PRACTICE_CONTENT);
    await pg.query("INSERT INTO daily_schedule (date, pack_id) VALUES ('2026-11-22', $1)", [PRACTICE_PACK.id]);
    expect(await getDailyEntry(db, "2026-11-22")).toBeNull();
  });
});
