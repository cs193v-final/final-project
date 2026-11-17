// Spec for picking today's daily challenge (#58): the same pack for everyone
// at the same moment, switching exactly at the reset time, including across
// daylight-saving changes, whatever the server's own time zone. PGlite with
// the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_DAILY_RESET, type DailyResetConfig } from "../game/daily-date.ts";
import { combineContent } from "../game/packs.ts";
import type { Pack, Puzzle } from "../game/types.ts";
import { seedContent } from "./content.ts";
import { BrokenDailyError, getDailyIntro, getDailyPack, todaysDate } from "./daily.ts";
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

// Days around the 2026 US daylight-saving changes (Mar 8 and Nov 1), each with
// its own theme, so a test can tell them apart without looking at ids.
const SCHEDULE: Record<string, { packId: string; theme: string }> = {
  "2026-03-07": { packId: "pk-a", theme: "Animals" },
  "2026-03-08": { packId: "pk-b", theme: "Birds" },
  "2026-03-09": { packId: "pk-c", theme: "Cities" },
  "2026-10-31": { packId: "pk-d", theme: "Desserts" },
  "2026-11-01": { packId: "pk-e", theme: "Engines" },
  "2026-11-20": { packId: "pk-f", theme: "Fruit" },
  "2026-11-21": { packId: "pk-g", theme: "Gardens" },
};

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
  const days = Object.entries(SCHEDULE);
  await seedContent(
    db,
    combineContent([
      {
        source: "test",
        content: {
          puzzles: days.flatMap(([, d]) => [puzzle(`pz-${d.packId}-1`, "Strawberry"), puzzle(`pz-${d.packId}-2`, "Pineapple")]),
          packs: days.map(([, d]) => pack(d.packId, d.theme, [`pz-${d.packId}-1`, `pz-${d.packId}-2`])),
          schedule: days.map(([date, d]) => ({ date, packId: d.packId })),
        },
      },
    ]),
  );
}, 60_000);

afterAll(async () => {
  await pg.close();
});

const realTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = realTZ;
});

/** Today's theme at an instant, or null on an empty day. */
async function themeAt(iso: string, reset: Readonly<DailyResetConfig> = DEFAULT_DAILY_RESET) {
  const intro = await getDailyIntro(db, todaysDate(new Date(iso), reset), reset);
  return intro.pack?.theme ?? null;
}

describe("today's daily", () => {
  it("shows the theme and the number of images, with no pack or puzzle ids, answers or images", async () => {
    const intro = await getDailyIntro(db, "2026-11-20", DEFAULT_DAILY_RESET);
    expect(intro).toEqual({ date: "2026-11-20", reset: DEFAULT_DAILY_RESET, pack: { theme: "Fruit", puzzleCount: 2 } });
    expect(JSON.stringify(intro)).not.toMatch(/pz-|pk-|Strawberry|Pineapple|images\.example/u);
  });

  it("switches at midnight Pacific: one second before is still yesterday", async () => {
    // Nov 21 00:00 PST = Nov 21 08:00 UTC.
    expect(await themeAt("2026-11-21T07:59:59Z")).toBe("Fruit");
    expect(await themeAt("2026-11-21T08:00:00Z")).toBe("Gardens");
  });

  it.each(["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"])(
    "doesn't depend on the server's own time zone (TZ=%s)",
    async (tz) => {
      process.env.TZ = tz;
      expect(await themeAt("2026-11-21T07:59:59Z")).toBe("Fruit");
      expect(await themeAt("2026-11-21T08:00:00Z")).toBe("Gardens");
    },
  );

  it("handles the spring change: midnight is 08:00 UTC the night of the change, 07:00 UTC the night after", async () => {
    // Mar 8 00:00 is still PST (the clocks change at 2 am).
    expect(await themeAt("2026-03-08T07:59:59Z")).toBe("Animals");
    expect(await themeAt("2026-03-08T08:00:00Z")).toBe("Birds");
    // Mar 9 00:00 is PDT.
    expect(await themeAt("2026-03-09T06:59:59Z")).toBe("Birds");
    expect(await themeAt("2026-03-09T07:00:00Z")).toBe("Cities");
  });

  it("handles the fall change: midnight is 07:00 UTC while still in PDT", async () => {
    expect(await themeAt("2026-11-01T06:59:59Z")).toBe("Desserts");
    expect(await themeAt("2026-11-01T07:00:00Z")).toBe("Engines");
  });

  it("follows a different reset time when one is configured", async () => {
    const sixAmUtc = { timeZone: "UTC", resetHour: 6 };
    expect(await themeAt("2026-11-21T05:59:59Z", sixAmUtc)).toBe("Fruit");
    expect(await themeAt("2026-11-21T06:00:00Z", sixAmUtc)).toBe("Gardens");
  });

  it("returns no pack on a day with nothing scheduled", async () => {
    expect(await getDailyIntro(db, "2026-11-25", DEFAULT_DAILY_RESET)).toEqual({
      date: "2026-11-25",
      reset: DEFAULT_DAILY_RESET,
      pack: null,
    });
  });

  it("returns the full pack, in play order, for starting the game on the server", async () => {
    expect(await getDailyPack(db, "2026-11-20")).toEqual(pack("pk-f", "Fruit", ["pz-pk-f-1", "pz-pk-f-2"]));
  });

  it("ignores a day whose schedule row points at a pack that isn't daily", async () => {
    await pg.query("INSERT INTO packs (id, kind, title, theme) VALUES ('pk-p', 'practice', 'Practice', 'Mixed')");
    await pg.query("INSERT INTO daily_schedule (date, pack_id) VALUES ('2026-12-01', 'pk-p')");
    expect(await getDailyPack(db, "2026-12-01")).toBeNull();
  });

  it("treats a scheduled pack with no puzzles as broken, not as an empty day", async () => {
    await pg.query("INSERT INTO packs (id, kind, title, theme) VALUES ('pk-x', 'daily', 'Broken', 'Broken')");
    await pg.query("INSERT INTO daily_schedule (date, pack_id) VALUES ('2026-12-02', 'pk-x')");
    await expect(getDailyIntro(db, "2026-12-02", DEFAULT_DAILY_RESET)).rejects.toBeInstanceOf(BrokenDailyError);
  });
});
