// The pieces of scripts/pack-scoring.ts that don't need a real database:
// argument parsing, and each command run against PGlite with the real
// migrations. `main()` only runs when the file is executed, not imported.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import { ScoringConfigError } from "@/game/scoring-override";

import { parseCommand, runCommand, UsageError } from "./pack-scoring";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
  await pg.query("INSERT INTO packs (id, kind, title, theme) VALUES ('p1', 'daily', 'T', 'T')");
}, 60_000);

afterAll(async () => {
  await pg.close();
});

describe("parseCommand", () => {
  it("parses show, clear, and set with inline JSON", () => {
    expect(parseCommand(["show", "p1"])).toEqual({ kind: "show", packId: "p1" });
    expect(parseCommand(["clear", "p1"])).toEqual({ kind: "clear", packId: "p1" });
    expect(parseCommand(["set", "p1", '{"maxPoints": 150}'])).toEqual({
      kind: "set",
      packId: "p1",
      override: { maxPoints: 150 },
    });
  });

  it("reads set's value from a file when it isn't inline JSON", () => {
    const files: Record<string, string> = { "scoring.json": '{"curve": 3}' };
    expect(parseCommand(["set", "p1", "scoring.json"], (path) => files[path]!)).toEqual({
      kind: "set",
      packId: "p1",
      override: { curve: 3 },
    });
  });

  it("points to clear when set's file doesn't exist, e.g. `set p1 null` (#174)", () => {
    const missing = (path: string): string => {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" });
    };
    for (const value of ["null", "scoring.jsn"]) {
      expect(() => parseCommand(["set", "p1", value], missing)).toThrow(UsageError);
      expect(() => parseCommand(["set", "p1", value], missing)).toThrow(`No file "${value}"`);
      expect(() => parseCommand(["set", "p1", value], missing)).toThrow("npm run db:scoring -- clear p1");
      expect(() => parseCommand(["set", "p1", value], missing)).not.toThrow(/ENOENT/);
    }
  });

  it("still reports other file errors as they are", () => {
    const denied = (): string => {
      throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    };
    expect(() => parseCommand(["set", "p1", "scoring.json"], denied)).toThrow(/EACCES/);
    expect(() => parseCommand(["set", "p1", "scoring.json"], denied)).not.toThrow(UsageError);
  });

  it.each([
    [[]],
    [["show"]],
    [["drop", "p1"]],
    [["show", "p1", "extra"]],
    [["set", "p1"]],
    [["set", "p1", "{not json"]],
  ])("rejects %j with the usage text", (args: string[]) => {
    expect(() => parseCommand(args)).toThrow(UsageError);
    expect(() => parseCommand(args)).toThrow(/Usage:/);
  });
});

describe("runCommand", () => {
  it("sets, shows and clears an override", async () => {
    await expect(runCommand(db, { kind: "set", packId: "p1", override: { maxPoints: 150 } })).resolves.toMatch(
      /"maxPoints": 150/,
    );
    await expect(runCommand(db, { kind: "show", packId: "p1" })).resolves.toMatch(/stored override/);
    await expect(runCommand(db, { kind: "clear", packId: "p1" })).resolves.toMatch(/uses the default/);
    const shown = await runCommand(db, { kind: "show", packId: "p1" });
    expect(shown).toContain("has no override");
    expect(shown).toContain(JSON.stringify(TIMED_SCORING_CONFIG, null, 2));
  });

  it("refuses an invalid override before writing", async () => {
    await expect(runCommand(db, { kind: "set", packId: "p1", override: { minPoints: 50_000 } })).rejects.toThrow(
      ScoringConfigError,
    );
    await expect(runCommand(db, { kind: "show", packId: "p1" })).resolves.toContain("has no override");
  });

  it("shows a bad override written by hand as invalid", async () => {
    await pg.query(`UPDATE packs SET scoring = '{"maxPoints": -1}' WHERE id = 'p1'`);
    await expect(runCommand(db, { kind: "show", packId: "p1" })).resolves.toMatch(/INVALID, so games use the default/);
    await runCommand(db, { kind: "clear", packId: "p1" });
  });
});

// Each test starts Node; on a busy machine that takes longer than the default 5 s (like seed.test.ts).
describe("the script's connection (#60)", { timeout: 30_000 }, () => {
  const script = fileURLToPath(new URL("./pack-scoring.ts", import.meta.url));
  const run = (url: string) =>
    spawnSync(process.execPath, [script, "show", "p1"], {
      env: { PATH: process.env.PATH, NODE_ENV: "test", DATABASE_URL_UNPOOLED: url },
      encoding: "utf8",
      timeout: 30_000,
    });

  // Placeholders built from parts, like src/db/tls.test.ts, so the secret
  // scanner doesn't mistake them for real connection strings.
  const host = "ep-example-123456.us-east-2.aws.neon.tech";
  const remote = (query: string) => `postgresql://USER:PASSWORD@${host}/neondb${query}`;

  it.each([
    ["no sslmode", ""],
    ["sslmode=disable", "?sslmode=disable"],
  ])("refuses a remote URL with %s before connecting, without printing it", (_, query) => {
    const result = run(remote(query));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DATABASE_URL_UNPOOLED must require TLS/);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("PASSWORD");
    expect(output).not.toContain(host);
  });

  it("talks to a Postgres on this machine with node-postgres, not Neon's HTTP driver (#174)", () => {
    // Nothing listens on port 1, so the connection is refused. Neon's HTTP
    // driver would fail with "fetch failed" instead.
    const result = run("postgresql://USER:PASSWORD@127.0.0.1:1/zoomout");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^db:scoring failed: /);
    expect(result.stderr).toMatch(/Caused by: .*ECONNREFUSED/);
    expect(result.stderr).not.toMatch(/fetch failed/);
    expect(result.stdout + result.stderr).not.toContain("PASSWORD");
  });
});
