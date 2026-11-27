// Spec for the photo credits page (#239): past dailies are listed with their
// photos' credits; today's and future dailies never are, and nothing that
// could name an answer comes back. PGlite with the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { combineContent } from "../game/packs.ts";
import type { Pack, Puzzle } from "../game/types.ts";
import { seedContent } from "./content.ts";
import { getPastDailyCredits } from "./credits.ts";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

const puzzle = (id: string, answer: string, author: string): Puzzle => ({
  id,
  imageUrl: `https://images.example.com/${id}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: `${author}, via Wikimedia Commons`, license: "CC BY-SA 4.0, cropped", url: `https://commons.example/${id}` },
  aiSolvedLevel: null,
});
const pack = (id: string, kind: Pack["kind"], title: string, puzzleIds: string[]): Pack => ({ id, kind, title, theme: title, puzzleIds });

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
  await seedContent(
    db,
    combineContent([
      {
        source: "test",
        content: {
          puzzles: [
            puzzle("pz-a1", "Strawberry", "Ann"),
            puzzle("pz-a2", "Pineapple", "Bo"),
            puzzle("pz-b1", "Flamingo", "Cy"),
            puzzle("pz-c1", "Donut", "Di"),
            puzzle("pz-d1", "Rocket", "Ed"),
            puzzle("pz-s1", "Hoover Tower", "Flo"),
          ],
          packs: [
            pack("pk-a", "daily", "Fruit", ["pz-a2", "pz-a1"]),
            pack("pk-b", "daily", "Birds", ["pz-b1"]),
            pack("pk-c", "daily", "Desserts", ["pz-c1"]),
            pack("pk-d", "daily", "Space", ["pz-d1"]),
            pack("pk-s", "stanford", "Stanford", ["pz-s1"]),
          ],
          schedule: [
            { date: "2026-12-01", packId: "pk-a" },
            { date: "2026-12-02", packId: "pk-b" },
            { date: "2026-12-03", packId: "pk-c" }, // "today" in these tests
            { date: "2026-12-04", packId: "pk-d" },
          ],
        },
      },
    ]),
  );
});

afterAll(async () => {
  await pg.close();
});

describe("getPastDailyCredits", () => {
  it("lists the dailies before today, newest first, each photo's credit in play order", async () => {
    expect(await getPastDailyCredits(db, "2026-12-03")).toEqual([
      { date: "2026-12-02", title: "Birds", credits: [{ source: "Cy, via Wikimedia Commons", license: "CC BY-SA 4.0, cropped", url: "https://commons.example/pz-b1" }] },
      {
        date: "2026-12-01",
        title: "Fruit",
        credits: [
          { source: "Bo, via Wikimedia Commons", license: "CC BY-SA 4.0, cropped", url: "https://commons.example/pz-a2" },
          { source: "Ann, via Wikimedia Commons", license: "CC BY-SA 4.0, cropped", url: "https://commons.example/pz-a1" },
        ],
      },
    ]);
  });

  it("never lists today's or a future daily, or the Stanford pack", async () => {
    const text = JSON.stringify(await getPastDailyCredits(db, "2026-12-03"));
    for (const hidden of ["Desserts", "Di,", "Space", "Ed,", "Stanford", "Flo,"]) expect(text).not.toContain(hidden);
  });

  it("returns no answers, ids or image URLs", async () => {
    const text = JSON.stringify(await getPastDailyCredits(db, "2026-12-05"));
    for (const secret of ["Strawberry", "Pineapple", "Flamingo", "Donut", "Rocket", "images.example.com"]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/"(id|answer|imageUrl)"/);
  });

  it("is empty before the first daily", async () => {
    expect(await getPastDailyCredits(db, "2026-12-01")).toEqual([]);
  });
});
