// Spec for finding Stanford mode's pack (#65): one fixed pack of kind
// "stanford", no schedule. Nothing loaded is "not loaded yet", not an error.
// PGlite with the real migrations. The content is obviously fake test data:
// the real Stanford pack is private and never in the repo.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { combineContent } from "../game/packs.ts";
import type { Pack, Puzzle } from "../game/types.ts";
import { seedContent } from "./content.ts";
import * as schema from "./schema.ts";
import { getStanfordIntro, getStanfordPack } from "./stanford.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

const puzzle = (id: string, answer: string): Puzzle => ({
  id,
  imageUrl: `https://images.example.com/${id}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: "Test Photographer", license: "CC0", url: "https://images.example.com/credits" },
  aiSolvedLevel: null,
});
const stanford = (id: string, puzzleIds: string[]): Pack => ({
  id,
  kind: "stanford",
  title: "Stanford (test)",
  theme: "Fake campus spots",
  puzzleIds,
});

const seed = (content: { puzzles?: Puzzle[]; packs?: Pack[] }) =>
  seedContent(db, combineContent([{ source: "test", content: { puzzles: [], packs: [], schedule: [], ...content } }]));

beforeEach(async () => {
  await pg?.close();
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("the Stanford pack", () => {
  it("isn't loaded on a fresh database: no pack, not broken", async () => {
    expect(await getStanfordPack(db)).toBeNull();
    expect(await getStanfordIntro(db)).toEqual({ pack: null });
  });

  it("ignores packs of other kinds", async () => {
    await seed({
      puzzles: [puzzle("pz-t1", "Test Answer One")],
      packs: [{ id: "pk-t-daily", kind: "daily", title: "Daily", theme: "Daily", puzzleIds: ["pz-t1"] }],
    });
    expect(await getStanfordPack(db)).toBeNull();
  });

  it("is the seeded stanford pack, with its puzzles in play order", async () => {
    await seed({
      puzzles: [puzzle("pz-t1", "Test Answer One"), puzzle("pz-t2", "Test Answer Two")],
      packs: [stanford("pk-t-stanford", ["pz-t2", "pz-t1"])],
    });
    expect(await getStanfordPack(db)).toEqual(stanford("pk-t-stanford", ["pz-t2", "pz-t1"]));
    expect(await getStanfordIntro(db)).toEqual({
      pack: { title: "Stanford (test)", theme: "Fake campus spots", puzzleCount: 2 },
    });
  });

  it("is the newest one if a replacement was seeded later under a new id (seeding never deletes a pack)", async () => {
    await seed({ puzzles: [puzzle("pz-t1", "Test Answer One")], packs: [stanford("pk-t-old", ["pz-t1"])] });
    await pg.exec("UPDATE packs SET created_at = now() - interval '1 day' WHERE id = 'pk-t-old'");
    await seed({ puzzles: [puzzle("pz-t2", "Test Answer Two")], packs: [stanford("pk-t-new", ["pz-t2"])] });
    expect((await getStanfordPack(db))?.id).toBe("pk-t-new");
  });

  it("carries the pack's own scoring (#64)", async () => {
    await seed({ puzzles: [puzzle("pz-t1", "Test Answer One")], packs: [stanford("pk-t-stanford", ["pz-t1"])] });
    const scoring = { basePoints: 50, revealPenalty: 5, wrongGuessPenalty: 5, minPoints: 5, skipPoints: 0 };
    await pg.query("UPDATE packs SET scoring = $1 WHERE id = 'pk-t-stanford'", [JSON.stringify(scoring)]);
    expect((await getStanfordPack(db))?.scoring).toEqual(scoring);
  });

  it("is broken, not 'not loaded', when the pack has no puzzles (a partial seed), and says so in the log", async () => {
    await pg.exec("INSERT INTO packs (id, kind, title, theme) VALUES ('pk-t-empty', 'stanford', 'S', 'S')");
    await expect(getStanfordPack(db)).rejects.toThrow(/pk-t-empty has no puzzles/u);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getStanfordIntro(db)).toEqual({ pack: null, broken: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("pk-t-empty"));
    log.mockRestore();
  });
});
