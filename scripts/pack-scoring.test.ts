// The pieces of scripts/pack-scoring.ts that don't need a real database:
// argument parsing, and each command run against PGlite with the real
// migrations. `main()` only runs when the file is executed, not imported.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { SCORING_CONFIG } from "@/game/scoring-config";
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
    expect(parseCommand(["set", "p1", '{"basePoints": 150}'])).toEqual({
      kind: "set",
      packId: "p1",
      override: { basePoints: 150 },
    });
  });

  it("reads set's value from a file when it isn't inline JSON", () => {
    const files: Record<string, string> = { "scoring.json": '{"skipPoints": 5}' };
    expect(parseCommand(["set", "p1", "scoring.json"], (path) => files[path]!)).toEqual({
      kind: "set",
      packId: "p1",
      override: { skipPoints: 5 },
    });
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
    await expect(runCommand(db, { kind: "set", packId: "p1", override: { basePoints: 150 } })).resolves.toMatch(
      /"basePoints": 150/,
    );
    await expect(runCommand(db, { kind: "show", packId: "p1" })).resolves.toMatch(/stored override/);
    await expect(runCommand(db, { kind: "clear", packId: "p1" })).resolves.toMatch(/uses the default/);
    const shown = await runCommand(db, { kind: "show", packId: "p1" });
    expect(shown).toContain("has no override");
    expect(shown).toContain(JSON.stringify(SCORING_CONFIG, null, 2));
  });

  it("refuses an invalid override before writing", async () => {
    await expect(runCommand(db, { kind: "set", packId: "p1", override: { minPoints: 500 } })).rejects.toThrow(
      ScoringConfigError,
    );
    await expect(runCommand(db, { kind: "show", packId: "p1" })).resolves.toContain("has no override");
  });

  it("shows a bad override written by hand as invalid", async () => {
    await pg.query(`UPDATE packs SET scoring = '{"basePoints": -1}' WHERE id = 'p1'`);
    await expect(runCommand(db, { kind: "show", packId: "p1" })).resolves.toMatch(/INVALID, so games use the default/);
    await runCommand(db, { kind: "clear", packId: "p1" });
  });
});
