// The server side of /play (#54) end to end, minus HTTP: the owner cookie
// (next/headers, stubbed), the practice pack, the game service and the
// Postgres store on PGlite with the real migrations.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  jar: new Map<string, string>(),
  /** Request headers besides x-forwarded-proto, e.g. x-forwarded-for. */
  headers: {} as Record<string, string>,
}));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-proto": "https", ...state.headers }),
}));

const { actOnGame, loadGame, startPracticeGame } = await import("./games");
const { GAME_LIMITS, MAX_UNFINISHED_GAMES } = await import("./limits");

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

beforeEach(async () => {
  state.jar.clear();
  state.headers = {};
  await pg.exec("DELETE FROM rate_limits;");
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

/** Games of the anonymous owner in the cookie jar. */
async function ownGameCount(): Promise<number> {
  const { hashOwnerToken, OWNER_COOKIE } = await import("./owner");
  const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM games WHERE anon_owner_hash = $1", [
    hashOwnerToken(state.jar.get(OWNER_COOKIE)!),
  ]);
  return rows[0]!.n;
}

describe("reusing games and the unfinished-games cap (#85)", () => {
  it("reuses the player's untouched practice game instead of creating a row, but not once it's been played", async () => {
    const first = await started();
    expect((await started()).gameId).toBe(first.gameId); // a refresh of /play, or Start practice again
    expect(await ownGameCount()).toBe(1);

    await actOnGame(first.gameId, { type: "reveal" });
    const second = await started();
    expect(second.gameId).not.toBe(first.gameId);
    expect(second.round).toMatchObject({ position: 1, revealLevel: 0 });
    expect(await ownGameCount()).toBe(2);
  });

  it(`never lets a player have more than ${MAX_UNFINISHED_GAMES} unfinished games: the next start resumes the latest`, async () => {
    let latest = "";
    for (let i = 0; i < MAX_UNFINISHED_GAMES; i++) {
      latest = (await started()).gameId;
      await actOnGame(latest, { type: "reveal" });
    }
    expect(await ownGameCount()).toBe(MAX_UNFINISHED_GAMES);

    const resumed = await started();
    expect(resumed.gameId).toBe(latest);
    expect(resumed.round).toMatchObject({ revealLevel: 1 });
    expect(await ownGameCount()).toBe(MAX_UNFINISHED_GAMES);
  });

  it("starts a new game after a finished one (Play again), even with other unfinished games", async () => {
    const view = await started();
    for (let i = 0; i < view.round!.puzzleCount; i++) {
      await actOnGame(view.gameId, { type: "skip" });
      await actOnGame(view.gameId, { type: "next" });
    }
    expect(await loadGame(view.gameId)).toMatchObject({ ok: true, view: { finished: true } });
    const again = await started();
    expect(again.gameId).not.toBe(view.gameId);
    expect(again.finished).toBe(false);
  });

  it("refuses with `rate-limited` at the cap when there's no practice game to resume", async () => {
    const view = await started();
    const { rows } = await pg.query<{ anon_owner_hash: string; state: unknown }>(
      "SELECT anon_owner_hash, state FROM games WHERE id = $1",
      [view.gameId],
    );
    const own = rows[0]!;
    await pg.query(
      "INSERT INTO packs (id, kind, title, theme) VALUES ('pk_other_85', 'practice', 'Other', 'Mixed') ON CONFLICT DO NOTHING",
    );
    for (let i = 0; i < MAX_UNFINISHED_GAMES; i++) {
      await pg.query("INSERT INTO games (pack_id, anon_owner_hash, state) VALUES ('pk_other_85', $1, $2)", [
        own.anon_owner_hash,
        JSON.stringify(own.state),
      ]);
    }
    await pg.query("DELETE FROM games WHERE id = $1", [view.gameId]);
    expect(await startPracticeGame()).toEqual({ ok: false, error: "rate-limited" });
    expect(await ownGameCount()).toBe(MAX_UNFINISHED_GAMES);
  });
});

describe("rate limits through the game server functions (#85)", () => {
  const T0 = new Date("2026-11-17T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: T0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns `rate-limited` for the first start over the owner limit, and allows it again in the next window", async () => {
    const view = await started();
    for (let i = 1; i < GAME_LIMITS.startsPerOwner.max; i++) await started();
    expect(await startPracticeGame()).toEqual({ ok: false, error: "rate-limited" });
    expect(await ownGameCount()).toBe(1);

    vi.setSystemTime(T0.getTime() + GAME_LIMITS.startsPerOwner.windowMs);
    expect(await startPracticeGame()).toEqual({ ok: true, view });
  });

  it("returns `rate-limited` for the first move over the owner limit without applying it, then allows moves again", async () => {
    const view = await started();
    // Loads count too: they read the database like a move does.
    for (let i = 0; i < GAME_LIMITS.actionsPerOwner.max; i++) expect((await loadGame(view.gameId)).ok).toBe(true);
    expect(await actOnGame(view.gameId, { type: "reveal" })).toEqual({ ok: false, error: "rate-limited" });
    expect(await loadGame(view.gameId)).toEqual({ ok: false, error: "rate-limited" });

    vi.setSystemTime(T0.getTime() + GAME_LIMITS.actionsPerOwner.windowMs);
    expect(await actOnGame(view.gameId, { type: "reveal" })).toMatchObject({ ok: true, view: { round: { revealLevel: 1 } } });
  });

  it("counts per IP from the first x-forwarded-for entry, across players, storing only keyed hashes", async () => {
    state.headers = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
    for (let i = 0; i < GAME_LIMITS.startsPerIp.max; i++) {
      state.jar.clear(); // a new anonymous player each time
      await started();
    }
    state.jar.clear();
    expect(await startPracticeGame()).toEqual({ ok: false, error: "rate-limited" });
    // Another address behind the same proxy hop is counted on its own.
    state.headers = { "x-forwarded-for": "198.51.100.20, 10.0.0.1" };
    expect((await startPracticeGame()).ok).toBe(true);

    const { rows } = await pg.query<{ key: string }>("SELECT key FROM rate_limits WHERE key LIKE 'game:start:ip:%'");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key).join(" ")).not.toMatch(/203\.0\.113\.7|198\.51\.100\.20|10\.0\.0\.1/);
  }, 120_000);

  it("uses x-real-ip when there's no x-forwarded-for, and one shared bucket with neither", async () => {
    state.headers = { "x-real-ip": "192.0.2.44" };
    await started();
    state.headers = {};
    await started();
    const { rows } = await pg.query<{ key: string }>("SELECT key FROM rate_limits WHERE key LIKE 'game:start:ip:%'");
    expect(rows.map((r) => r.key)).toContain("game:start:ip:unknown");
    expect(rows).toHaveLength(2);
  });
});
