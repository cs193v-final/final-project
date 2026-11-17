// Spec for picking today's daily challenge (#58): the same pack for everyone
// at the same moment, switching exactly at the reset time, including across
// daylight-saving changes. PGlite with the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_DAILY_RESET } from "../game/daily-date.ts";
import { combineContent } from "../game/packs.ts";
import type { Pack, Puzzle } from "../game/types.ts";
import { seedContent } from "./content.ts";
import { getTodaysDaily, toIntro } from "./daily.ts";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

const puzzle = (id: string, answer: string): Puzzle => ({
  id,
  imageUrl: `https://images.example.com/${id}.jpg`,
  answer,
  acceptedAnswers: [],
  reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
  credit: { source: "Someone", license: "CC0" },
  aiSolvedLevel: null,
});
const pack = (id: string, theme: string, puzzleIds: string[]): Pack => ({ id, kind: "daily", title: theme, theme, puzzleIds });

// Days chosen around the 2026 US daylight-saving changes (Mar 8 and Nov 1).
const SCHEDULE = {
  "2026-03-07": "pk-a",
  "2026-03-08": "pk-b",
  "2026-10-31": "pk-c",
  "2026-11-01": "pk-d",
  "2026-11-20": "pk-e",
  "2026-11-21": "pk-f",
} as const;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
  const ids = Object.values(SCHEDULE);
  await seedContent(
    db,
    combineContent([
      {
        source: "test",
        content: {
          puzzles: ids.flatMap((p) => [puzzle(`pz-${p}-1`, "Strawberry"), puzzle(`pz-${p}-2`, "Pineapple")]),
          packs: ids.map((p) => pack(p, `Theme ${p}`, [`pz-${p}-1`, `pz-${p}-2`])),
          schedule: Object.entries(SCHEDULE).map(([date, packId]) => ({ date, packId })),
        },
      },
    ]),
  );
}, 60_000);

afterAll(async () => {
  await pg.close();
});

const packAt = async (iso: string, reset = DEFAULT_DAILY_RESET) => (await getTodaysDaily(db, new Date(iso), reset)).fullPack?.id ?? null;

describe("getTodaysDaily", () => {
  it("shows the theme and the number of images, with no puzzle ids or answers", async () => {
    const today = await getTodaysDaily(db, new Date("2026-11-20T18:00:00Z"), DEFAULT_DAILY_RESET);
    expect(toIntro(today)).toEqual({ date: "2026-11-20", pack: { title: "Theme pk-e", theme: "Theme pk-e", puzzleCount: 2 } });
    expect(JSON.stringify(toIntro(today))).not.toMatch(/pz-|Strawberry|Pineapple|images\.example/u);
  });

  it("switches at midnight Pacific: one second before is still yesterday", async () => {
    // Nov 21 00:00 PST = Nov 21 08:00 UTC.
    expect(await packAt("2026-11-21T07:59:59Z")).toBe("pk-e");
    expect(await packAt("2026-11-21T08:00:00Z")).toBe("pk-f");
  });

  it("gives everyone the same pack at the same moment, wherever their clock is", async () => {
    // The same instant, written with three different offsets.
    const instants = ["2026-11-20T23:30:00-08:00", "2026-11-21T07:30:00Z", "2026-11-21T16:30:00+09:00"];
    expect(new Set(await Promise.all(instants.map((i) => packAt(i))))).toEqual(new Set(["pk-e"]));
  });

  it("handles the spring daylight-saving change (midnight is 08:00 UTC before, 07:00 after)", async () => {
    // Mar 8 00:00 PST = 08:00 UTC; clocks jump that night, but midnight is still before the change.
    expect(await packAt("2026-03-08T07:59:59Z")).toBe("pk-a");
    expect(await packAt("2026-03-08T08:00:00Z")).toBe("pk-b");
  });

  it("handles the fall daylight-saving change (midnight is 07:00 UTC in PDT)", async () => {
    // Nov 1 00:00 PDT = 07:00 UTC; the clocks fall back later that night.
    expect(await packAt("2026-11-01T06:59:59Z")).toBe("pk-c");
    expect(await packAt("2026-11-01T07:00:00Z")).toBe("pk-d");
  });

  it("follows a different reset time when one is configured", async () => {
    const sixAmUtc = { timeZone: "UTC", resetHour: 6 };
    expect(await packAt("2026-11-21T05:59:59Z", sixAmUtc)).toBe("pk-e");
    expect(await packAt("2026-11-21T06:00:00Z", sixAmUtc)).toBe("pk-f");
  });

  it("returns no pack on a day with nothing scheduled", async () => {
    const today = await getTodaysDaily(db, new Date("2026-11-25T18:00:00Z"), DEFAULT_DAILY_RESET);
    expect(today).toEqual({ date: "2026-11-25", pack: null, fullPack: null });
  });
});
