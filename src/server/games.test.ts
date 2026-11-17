// The server side of /play (#54) end to end, minus HTTP: the owner cookie
// (next/headers, stubbed), the practice pack, the game service and the
// Postgres store on PGlite with the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  jar: new Map<string, string>(),
}));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-proto": "https" }),
}));

const { actOnGame, loadGame, startPracticeGame } = await import("./games");

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  state.db = db;
}, 60_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(() => {
  state.jar.clear();
});

async function started() {
  const result = await startPracticeGame();
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.view;
}

describe("startPracticeGame / actOnGame / loadGame", () => {
  it("starts a practice game for a new anonymous owner and plays it", async () => {
    const view = await started();
    expect(view.round).toMatchObject({ position: 1, state: "playing" });
    expect(await actOnGame(view.gameId, { type: "reveal" })).toMatchObject({ ok: true, view: { round: { revealLevel: 1 } } });
    expect(await loadGame(view.gameId)).toMatchObject({ ok: true, view: { round: { revealLevel: 1 } } });
  });

  it("rejects a malformed action as `invalid` and changes nothing", async () => {
    const view = await started();
    for (const bad of [null, "skip", { type: "score", points: 1000 }, { type: "guess", guess: 42 }]) {
      expect(await actOnGame(view.gameId, bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect(await loadGame(view.gameId)).toEqual({ ok: true, view });
  });

  it("gives `not-found` for someone else's game, a missing game, a bad id, and no cookie at all", async () => {
    const view = await started();
    const mine = new Map(state.jar);

    state.jar.clear();
    expect(await loadGame(view.gameId)).toEqual({ ok: false, error: "not-found" });
    expect(await actOnGame(view.gameId, { type: "skip" })).toEqual({ ok: false, error: "not-found" });

    await started(); // a second visitor, with their own cookie
    expect(await loadGame(view.gameId)).toEqual({ ok: false, error: "not-found" });
    expect(await actOnGame(view.gameId, { type: "skip" })).toEqual({ ok: false, error: "not-found" });

    state.jar = mine;
    expect(await loadGame("00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "not-found" });
    expect(await loadGame("not-a-uuid")).toEqual({ ok: false, error: "not-found" });
    expect(await loadGame(42)).toEqual({ ok: false, error: "not-found" });
    expect(await loadGame(view.gameId)).toEqual({ ok: true, view });
  });
});

describe("one practice pack (#52)", () => {
  it("plays #52's practice pack, and the seed script can load it after games exist without a second pack", async () => {
    const { PRACTICE_CONTENT, PRACTICE_PACK } = await import("@/puzzles");
    const { seedContent } = await import("@/db/content");
    const db = state.db as Parameters<typeof seedContent>[0];
    const view = await started();
    expect(view.pack.id).toBe(PRACTICE_PACK.id);

    // The app inserted the pack row on first use; seeding now adds its
    // puzzles and puzzle list to that same row (it has games, but no list yet).
    await seedContent(db, PRACTICE_CONTENT);
    await seedContent(db, PRACTICE_CONTENT); // and again: nothing changes
    const packRows = await pg.query<{ id: string }>("SELECT id FROM packs WHERE kind = 'practice'");
    expect(packRows.rows).toEqual([{ id: PRACTICE_PACK.id }]);
    const order = await pg.query<{ puzzle_id: string }>(
      "SELECT puzzle_id FROM pack_puzzles WHERE pack_id = $1 ORDER BY position",
      [PRACTICE_PACK.id],
    );
    expect(order.rows.map((r) => r.puzzle_id)).toEqual(PRACTICE_PACK.puzzleIds);

    // And games keep working on the seeded pack.
    expect((await startPracticeGame()).ok).toBe(true);
    expect(await actOnGame(view.gameId, { type: "skip" })).toMatchObject({ ok: true });
  });
});
