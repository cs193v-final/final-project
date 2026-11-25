// The home page's "How to play" numbers (#204): the practice pack's scoring,
// read through a cached server function. On PGlite with the real migrations;
// `next/cache` is stubbed (the caching itself is Next's, checked by the build:
// `/` stays partially prerendered).
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ensurePackRow } from "@/db/games";
import { setPackScoring } from "@/db/pack-scoring";
import * as schema from "@/db/schema";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { PRACTICE_PACK } from "@/puzzles";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({
  getDb: () => {
    if (state.db === undefined) throw new Error("DATABASE_URL is not set");
    return state.db;
  },
}));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const { loadPracticeScoring } = await import("./practice-scoring");

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
}, 60_000);

afterAll(async () => {
  await pg.close();
});

afterEach(() => {
  state.db = db;
  vi.restoreAllMocks();
});

describe("loadPracticeScoring", () => {
  it("gives the default, logged, when the practice pack has no row yet (no game started)", async () => {
    state.db = db;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadPracticeScoring()).toEqual(SCORING_CONFIG);
    expect(log).toHaveBeenCalledOnce();
  });

  it("gives the default when the practice pack has no override", async () => {
    state.db = db;
    await ensurePackRow(db, PRACTICE_PACK);
    expect(await loadPracticeScoring()).toEqual(SCORING_CONFIG);
  });

  it("gives the practice pack's stored override, merged over the default", async () => {
    state.db = db;
    await ensurePackRow(db, PRACTICE_PACK);
    await setPackScoring(db, PRACTICE_PACK.id, { basePoints: 250, skipPoints: 5 });
    expect(await loadPracticeScoring()).toEqual({ ...SCORING_CONFIG, basePoints: 250, skipPoints: 5 });
    await setPackScoring(db, PRACTICE_PACK.id, null);
  });

  it("gives the default, logged, without throwing, when the database can't be reached", async () => {
    state.db = undefined;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadPracticeScoring()).resolves.toEqual(SCORING_CONFIG);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("practice pack"), expect.any(Error));
  });

  it("gives the default when a query fails", async () => {
    state.db = db;
    await ensurePackRow(db, PRACTICE_PACK);
    await setPackScoring(db, PRACTICE_PACK.id, { basePoints: 250 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "select").mockImplementation(() => {
      throw new Error("connection reset");
    });
    await expect(loadPracticeScoring()).resolves.toEqual(SCORING_CONFIG);
    expect(log).toHaveBeenCalledOnce();
    await setPackScoring(db, PRACTICE_PACK.id, null);
  });

  it("returns a copy, so a caller can't change the default", async () => {
    state.db = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const config = await loadPracticeScoring();
    expect(config).not.toBe(SCORING_CONFIG);
  });
});
