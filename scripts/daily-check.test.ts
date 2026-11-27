// Spec for scripts/daily-check.ts (#223): which days of the coming range the
// daily schedule covers. Pure logic first, then the query against PGlite with
// the real migrations, then the script itself (spawned) for its connection
// and exit codes. `main()` only runs when the file is executed, not imported.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

import {
  checkSchedule,
  dailyToday,
  datesInRange,
  DEFAULT_DAYS_AHEAD,
  findGaps,
  formatCoverage,
  isFullyCovered,
  MAX_DAYS,
  parseArgs,
  UsageError,
  type ScheduledDay,
} from "./daily-check";

const daily = (date: string, puzzleCount = 3): ScheduledDay => ({ date, kind: "daily", puzzleCount });

describe("dailyToday", () => {
  it("is the date in Pacific time, not UTC (December, so no daylight saving)", () => {
    // 07:59 UTC on Dec 1 is 23:59 PST on Nov 30; 08:00 UTC is midnight PST.
    expect(dailyToday(new Date("2026-12-01T07:59:59Z"))).toBe("2026-11-30");
    expect(dailyToday(new Date("2026-12-01T08:00:00Z"))).toBe("2026-12-01");
  });
});

describe("parseArgs", () => {
  it("defaults to today through today + 14 days", () => {
    expect(DEFAULT_DAYS_AHEAD).toBe(14);
    expect(parseArgs([], "2026-11-27")).toEqual({ from: "2026-11-27", through: "2026-12-11" });
  });

  it("takes --through as a separate argument or with =", () => {
    expect(parseArgs(["--through", "2026-12-10"], "2026-11-27")).toEqual({ from: "2026-11-27", through: "2026-12-10" });
    expect(parseArgs(["--through=2026-12-10"], "2026-11-27")).toEqual({ from: "2026-11-27", through: "2026-12-10" });
  });

  it("accepts today itself as --through (a one-day range)", () => {
    expect(parseArgs(["--through", "2026-11-27"], "2026-11-27")).toEqual({ from: "2026-11-27", through: "2026-11-27" });
  });

  it.each([
    ["a date before today", ["--through", "2026-11-26"], /before today/],
    ["a date that doesn't exist", ["--through", "2026-11-31"], /not a real date/],
    ["a date in another format", ["--through", "12/10/2026"], /not a real date/],
    ["--through without a date", ["--through"], /needs a date/],
    ["an unknown argument", ["--from", "2026-11-27"], /Unknown argument/],
    ["--through twice", ["--through", "2026-12-01", "--through", "2026-12-02"], /more than once/],
    ["a range over the limit", ["--through", "2062-01-01"], new RegExp(`more than ${MAX_DAYS} days`)],
  ])("rejects %s with a UsageError that shows the usage", (_, args, message) => {
    expect(() => parseArgs(args, "2026-11-27")).toThrow(UsageError);
    expect(() => parseArgs(args, "2026-11-27")).toThrow(message);
    expect(() => parseArgs(args, "2026-11-27")).toThrow(/Usage:/);
  });
});

describe("datesInRange", () => {
  it("crosses the end of November into December", () => {
    expect(datesInRange({ from: "2026-11-28", through: "2026-12-02" })).toEqual([
      "2026-11-28",
      "2026-11-29",
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
    ]);
  });

  it("is one day when from and through are the same, and empty when through is earlier", () => {
    expect(datesInRange({ from: "2026-12-04", through: "2026-12-04" })).toEqual(["2026-12-04"]);
    expect(datesInRange({ from: "2026-12-04", through: "2026-12-03" })).toEqual([]);
  });
});

describe("findGaps", () => {
  const range = { from: "2026-11-29", through: "2026-12-02" };

  it("is fully covered when every day has a daily pack with puzzles", () => {
    const c = findGaps(range, ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"].map((d) => daily(d)));
    expect(c).toMatchObject({ total: 4, covered: 4, missing: [], noPuzzles: [], notDaily: [] });
    expect(isFullyCovered(c)).toBe(true);
  });

  it("finds missing days across the Nov→Dec boundary", () => {
    const c = findGaps(range, [daily("2026-11-29"), daily("2026-12-02")]);
    expect(c.missing).toEqual(["2026-11-30", "2026-12-01"]);
    expect(c.covered).toBe(2);
    expect(isFullyCovered(c)).toBe(false);
  });

  it("counts a pack with no puzzles, or a pack that isn't a daily, as not covered", () => {
    const c = findGaps(range, [
      daily("2026-11-29"),
      daily("2026-11-30", 0),
      { date: "2026-12-01", kind: "practice", puzzleCount: 5 },
      daily("2026-12-02"),
    ]);
    expect(c).toMatchObject({ covered: 2, missing: [], noPuzzles: ["2026-11-30"], notDaily: ["2026-12-01"] });
    expect(isFullyCovered(c)).toBe(false);
  });

  it("ignores scheduled days outside the range", () => {
    const c = findGaps({ from: "2026-12-01", through: "2026-12-01" }, [daily("2026-11-30"), daily("2026-12-02")]);
    expect(c).toMatchObject({ total: 1, covered: 0, missing: ["2026-12-01"] });
  });
});

describe("formatCoverage", () => {
  it("prints the range, the count and each problem date", () => {
    const text = formatCoverage(
      findGaps({ from: "2026-11-30", through: "2026-12-02" }, [daily("2026-11-30"), daily("2026-12-02", 0)]),
    );
    expect(text).toBe(
      [
        "Daily schedule 2026-11-30 through 2026-12-02 (Pacific): 1 of 3 days covered.",
        "Nothing scheduled (1):",
        "  2026-12-01",
        "Scheduled pack has no puzzles (1):",
        "  2026-12-02",
      ].join("\n"),
    );
  });

  it("says so when every day is covered", () => {
    const text = formatCoverage(findGaps({ from: "2026-12-04", through: "2026-12-04" }, [daily("2026-12-04")]));
    expect(text).toMatch(/1 of 1 days covered/);
    expect(text).toMatch(/Every day is covered/);
  });
});

describe("checkSchedule against the real schema", () => {
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
  let pg: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    pg = new PGlite();
    db = drizzle({ client: pg, schema });
    await migrate(db, { migrationsFolder });
    await pg.exec(`
      INSERT INTO packs (id, kind, title, theme) VALUES
        ('pk-full', 'daily', 'Secret theme', 'Secret theme'),
        ('pk-empty', 'daily', 'Empty', 'Empty'),
        ('pk-practice', 'practice', 'Practice', 'Practice');
      INSERT INTO puzzles (id, answer, image_url, focus_x, focus_y, zoom_levels, credit_source, credit_license)
        VALUES ('pz-1', 'Secret answer', 'https://images.example.com/1.jpg', 0.5, 0.5, '{4,2,1}', 'Someone', 'CC0'),
               ('pz-2', 'Other answer', 'https://images.example.com/2.jpg', 0.5, 0.5, '{4,2,1}', 'Someone', 'CC0');
      INSERT INTO pack_puzzles (pack_id, puzzle_id, position) VALUES
        ('pk-full', 'pz-1', 1), ('pk-full', 'pz-2', 2), ('pk-practice', 'pz-1', 1);
      INSERT INTO daily_schedule (date, pack_id) VALUES
        ('2026-11-28', 'pk-full'),
        ('2026-11-29', 'pk-full'),
        ('2026-12-01', 'pk-empty'),
        ('2026-12-02', 'pk-practice'),
        ('2026-12-03', 'pk-full'),
        ('2026-12-10', 'pk-full');
    `);
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it("counts each scheduled pack's puzzles and reports the gaps", async () => {
    const c = await checkSchedule(db, { from: "2026-11-29", through: "2026-12-03" });
    expect(c).toEqual({
      range: { from: "2026-11-29", through: "2026-12-03" },
      total: 5,
      covered: 2,
      missing: ["2026-11-30"],
      noPuzzles: ["2026-12-01"],
      notDaily: ["2026-12-02"],
    });
  });

  it("only reads the range asked for", async () => {
    const c = await checkSchedule(db, { from: "2026-12-10", through: "2026-12-10" });
    expect(isFullyCovered(c)).toBe(true);
  });

  it("prints no pack ids, themes or answers", async () => {
    const text = formatCoverage(await checkSchedule(db, { from: "2026-11-28", through: "2026-12-10" }));
    expect(text).not.toMatch(/pk-|pz-|Secret|answer|Empty|Practice/u);
  });

  it("writes nothing", async () => {
    const before = await pg.query("SELECT count(*)::int AS n FROM daily_schedule");
    await checkSchedule(db, { from: "2026-11-28", through: "2026-12-10" });
    const after = await pg.query("SELECT count(*)::int AS n FROM daily_schedule");
    expect(after.rows).toEqual(before.rows);
  });
});

describe("the script", { timeout: 30_000 }, () => {
  const script = fileURLToPath(new URL("./daily-check.ts", import.meta.url));
  const run = (args: string[], url: string | undefined) =>
    spawnSync(process.execPath, [script, ...args], {
      env: { PATH: process.env.PATH, NODE_ENV: "test", ...(url === undefined ? {} : { DATABASE_URL_UNPOOLED: url }) },
      // Not the repo root, so no .env.local is picked up.
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      timeout: 30_000,
    });

  // Placeholders built from parts, like src/db/tls.test.ts, so the secret
  // scanner doesn't mistake them for real connection strings.
  const host = "ep-example-123456.us-east-2.aws.neon.tech";
  const remote = `postgresql://USER:PASSWORD@${host}/neondb`;

  it("exits 2 on a bad date, before connecting", () => {
    const result = run(["--through", "not-a-date"], remote);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/not a real date/);
  });

  it("exits 2 when DATABASE_URL_UNPOOLED is not set", () => {
    const result = run([], undefined);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/DATABASE_URL_UNPOOLED is not set/);
  });

  it("refuses a remote URL without TLS, without printing it", () => {
    const result = run([], remote);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/DATABASE_URL_UNPOOLED must require TLS/);
    expect(result.stdout + result.stderr).not.toContain("PASSWORD");
    expect(result.stdout + result.stderr).not.toContain(host);
  });

  it("talks to a Postgres on this machine with node-postgres, and exits 2 when it can't connect", () => {
    // Nothing listens on port 1, so the connection is refused.
    const result = run([], "postgresql://USER:PASSWORD@127.0.0.1:1/zoomout");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^db:daily-check failed: /);
    expect(result.stderr).toMatch(/Caused by: .*ECONNREFUSED/);
    expect(result.stdout + result.stderr).not.toContain("PASSWORD");
  });
});
