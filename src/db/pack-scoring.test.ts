// Per-pack scoring (#64) against the real migrations, applied to an in-memory
// Postgres (PGlite, no network), the same way src/db/schema.test.ts does it.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SCORING_CONFIG } from "@/game/scoring-config";
import { ScoringConfigError } from "@/game/scoring-override";
import type { ScoringConfig } from "@/game/types";

import { getPackScoringConfig, PackNotFoundError, readStoredScoring, setPackScoring } from "./pack-scoring";
import * as schema from "./schema";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgliteDatabase<typeof schema>;

// `getScoringConfig` (the server-only entry point) uses `getDb()`; point it at PGlite.
vi.mock("./index", () => ({ getDb: () => db }));

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder });
}, 60_000);

afterAll(async () => {
  await pg.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const CUSTOM: ScoringConfig = { basePoints: 200, revealPenalty: 30, wrongGuessPenalty: 15, minPoints: 20, skipPoints: 5 };

let counter = 0;

/** Inserts a pack with raw SQL, so `scoring` can be anything SQL allows. */
async function addPack(scoringJson: string | null = null): Promise<string> {
  const id = `pack-${++counter}`;
  await pg.query("INSERT INTO packs (id, kind, title, theme, scoring) VALUES ($1, 'daily', 'T', 'T', $2::jsonb)", [
    id,
    scoringJson,
  ]);
  return id;
}

async function storedJson(packId: string): Promise<unknown> {
  const { rows } = await pg.query<{ scoring: unknown }>("SELECT scoring FROM packs WHERE id = $1", [packId]);
  return rows[0]?.scoring;
}

describe("getPackScoringConfig", () => {
  it("uses the default when the pack has no override", async () => {
    const packId = await addPack(null);
    await expect(getPackScoringConfig(db, packId)).resolves.toEqual(SCORING_CONFIG);
  });

  it("uses a valid full override", async () => {
    const packId = await addPack(JSON.stringify(CUSTOM));
    await expect(getPackScoringConfig(db, packId)).resolves.toEqual(CUSTOM);
  });

  it("merges a partial override (e.g. written by hand in SQL) over the default", async () => {
    const packId = await addPack('{"basePoints": 150}');
    await expect(getPackScoringConfig(db, packId)).resolves.toEqual({ ...SCORING_CONFIG, basePoints: 150 });
  });

  it.each([
    ["fails validateScoringConfig", '{"basePoints": 5}'],
    ["has a negative value", '{"revealPenalty": -1}'],
    ["has a string value", '{"basePoints": "150"}'],
    ["has an unknown field", '{"basepoints": 150}'],
    ["isn't an object", "[1, 2, 3]"],
  ])("logs and falls back to the default when the stored override %s", async (_, json) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const packId = await addPack(json);
    await expect(getPackScoringConfig(db, packId)).resolves.toEqual(SCORING_CONFIG);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toMatch(new RegExp(`pack "${packId}" has an invalid scoring override`));
  });

  it("treats a JSON null like SQL NULL: no override, nothing logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getPackScoringConfig(db, await addPack("null"))).resolves.toEqual(SCORING_CONFIG);
    expect(error).not.toHaveBeenCalled();
  });

  it("throws PackNotFoundError for an unknown pack id", async () => {
    await expect(getPackScoringConfig(db, "no-such-pack")).rejects.toThrow(PackNotFoundError);
    await expect(getPackScoringConfig(db, "no-such-pack")).rejects.toThrow(/No pack with id "no-such-pack"/);
  });
});

describe("getScoringConfig (server-only entry point)", () => {
  it("reads through getDb()", async () => {
    const { getScoringConfig, PackNotFoundError: ExportedError } = await import("./scoring");
    const packId = await addPack(JSON.stringify(CUSTOM));
    await expect(getScoringConfig(packId)).resolves.toEqual(CUSTOM);
    await expect(getScoringConfig("no-such-pack")).rejects.toThrow(ExportedError);
  });
});

describe("setPackScoring", () => {
  it("stores a valid override, and the next read uses it", async () => {
    const packId = await addPack(null);
    await expect(setPackScoring(db, packId, CUSTOM)).resolves.toEqual(CUSTOM);
    expect(await storedJson(packId)).toEqual(CUSTOM);
    await expect(getPackScoringConfig(db, packId)).resolves.toEqual(CUSTOM);
  });

  it("stores a partial override merged over the default, so the pack's values are pinned", async () => {
    const packId = await addPack(null);
    const expected = { ...SCORING_CONFIG, basePoints: 150 };
    await expect(setPackScoring(db, packId, { basePoints: 150 })).resolves.toEqual(expected);
    expect(await storedJson(packId)).toEqual(expected);
  });

  it("clears the override with null", async () => {
    const packId = await addPack(JSON.stringify(CUSTOM));
    await expect(setPackScoring(db, packId, null)).resolves.toBeNull();
    expect(await readStoredScoring(db, packId)).toBeNull();
    await expect(getPackScoringConfig(db, packId)).resolves.toEqual(SCORING_CONFIG);
  });

  it.each([
    ["fails validateScoringConfig", { minPoints: 500 }],
    ["has a string value", { basePoints: "150" }],
    ["has an unknown field", { bonus: 10 }],
    ["isn't an object", 150],
  ])("validates before writing: rejects an override that %s and leaves the row unchanged", async (_, override) => {
    const packId = await addPack(JSON.stringify(CUSTOM));
    const update = vi.spyOn(db, "update");
    await expect(setPackScoring(db, packId, override)).rejects.toThrow(ScoringConfigError);
    expect(update).not.toHaveBeenCalled();
    expect(await storedJson(packId)).toEqual(CUSTOM);
  });

  it("throws PackNotFoundError for an unknown pack id", async () => {
    await expect(setPackScoring(db, "no-such-pack", CUSTOM)).rejects.toThrow(PackNotFoundError);
  });

  it("doesn't change other packs", async () => {
    const [a, b] = [await addPack(null), await addPack(null)];
    await setPackScoring(db, a, CUSTOM);
    expect(await storedJson(b)).toBeNull();
  });
});
