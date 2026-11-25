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
  /** Stands in for Next's connection(): resolves at request time, rejects while prerendering. */
  connection: async (): Promise<void> => {},
}));

// Game states are stored encrypted (#84); the app reads the key from the
// environment. Stubbed for this file only (restored in afterAll).
vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));

vi.mock("@/db", () => ({ getDb: () => state.db }));
vi.mock("next/server", () => ({ connection: () => state.connection() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => state.jar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-proto": "https", ...state.headers }),
}));

const { actOnGame, loadGame, startPracticeGame } = await import("./games");
const { setPackScoring } = await import("@/db/pack-scoring");
const { SCORING_CONFIG } = await import("@/game/scoring-config");
const { PRACTICE_PACK } = await import("@/puzzles");
const { GAME_LIMITS, MAX_UNFINISHED_GAMES_PER_PACK } = await import("./limits");

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const db = drizzle({ client: pg, schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  state.db = db;
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});

beforeEach(async () => {
  state.jar.clear();
  state.headers = {};
  await pg.exec("DELETE FROM rate_limits;");
  state.connection = async () => {};
});

async function started() {
  const result = await startPracticeGame();
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.view;
}

describe("while Next prerenders /play", () => {
  const signal = new Error("During prerendering, `connection()` rejects when the prerender is complete.");

  // Each call marks request time first, before its rate limits read the clock
  // (#169): a call that never awaited connection() would resolve here instead.
  // And Next's signal gets through instead of being logged and reported as
  // "unavailable".
  async function expectPrerenderSignal(call: () => Promise<unknown>) {
    state.connection = async () => {
      throw signal;
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(call()).rejects.toBe(signal);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  }

  it("loadGame", async () => {
    const view = await started();
    await expectPrerenderSignal(() => loadGame(view.gameId));
  });

  it("startPracticeGame", async () => {
    await expectPrerenderSignal(() => startPracticeGame());
  });

  it("actOnGame", async () => {
    const view = await started();
    await expectPrerenderSignal(() => actOnGame(view.gameId, { type: "reveal" }, view.revision));
  });
});

describe("startPracticeGame with per-pack scoring (#64)", () => {
  afterEach(async () => {
    await setPackScoring(state.db as never, PRACTICE_PACK.id, null);
  });

  it("plays new games with the pack's stored scoring, and leaves games already started alone", async () => {
    const before = await started(); // also inserts the practice pack's row
    expect(before.round!.pointsAvailable).toBe(SCORING_CONFIG.basePoints);

    const basePoints = SCORING_CONFIG.basePoints + 50;
    await setPackScoring(state.db as never, PRACTICE_PACK.id, { basePoints });
    const beforeOwner = new Map(state.jar);
    state.jar.clear(); // a new player, so it's a new game rather than the untouched one
    expect((await started()).round!.pointsAvailable).toBe(basePoints);

    state.jar = beforeOwner;
    expect(await loadGame(before.gameId)).toMatchObject({ ok: true, view: { round: { pointsAvailable: SCORING_CONFIG.basePoints } } });
  });

  it("plays with the default, and logs, when the stored override is invalid (hand-written SQL)", async () => {
    await started();
    await pg.query("UPDATE packs SET scoring = $1::jsonb WHERE id = $2", [JSON.stringify({ basePoints: -5 }), PRACTICE_PACK.id]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.jar.clear();
    expect((await started()).round!.pointsAvailable).toBe(SCORING_CONFIG.basePoints);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`pack "${PRACTICE_PACK.id}" has an invalid scoring override`));
    log.mockRestore();
  });
});

describe("startPracticeGame / actOnGame / loadGame", () => {
  it("starts a practice game for a new anonymous owner and plays it", async () => {
    const view = await started();
    expect(view.round).toMatchObject({ position: 1, state: "playing" });
    expect(await actOnGame(view.gameId, { type: "reveal" }, view.revision)).toMatchObject({ ok: true, view: { round: { revealLevel: 1 } } });
    expect(await loadGame(view.gameId)).toMatchObject({ ok: true, view: { round: { revealLevel: 1 } } });
  });

  it("rejects a malformed action as `invalid` and changes nothing", async () => {
    const view = await started();
    for (const bad of [null, "skip", { type: "score", points: 1000 }, { type: "guess", guess: 42 }]) {
      expect(await actOnGame(view.gameId, bad, view.revision)).toEqual({ ok: false, error: "invalid" });
    }
    expect(await loadGame(view.gameId)).toEqual({ ok: true, view });
  });

  it("rejects a missing or malformed revision as `invalid` and changes nothing (#107)", async () => {
    const view = await started();
    for (const bad of [undefined, null, "0", -1, 0.5, Number.NaN]) {
      expect(await actOnGame(view.gameId, { type: "skip" }, bad), String(bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect(await loadGame(view.gameId)).toEqual({ ok: true, view });
  });

  it("gives `conflict` for an action from a stale tab, and doesn't apply it (#107)", async () => {
    const tabA = await started();
    // Tab B, on the same game, moves it on: a reveal, then a skip to round 2.
    const afterReveal = await actOnGame(tabA.gameId, { type: "reveal" }, tabA.revision);
    if (!afterReveal.ok) throw new Error(afterReveal.error);
    const afterSkip = await actOnGame(tabA.gameId, { type: "skip" }, afterReveal.view.revision);
    if (!afterSkip.ok) throw new Error(afterSkip.error);
    // Tab A still shows round 1 and presses Skip: it must not skip round 2.
    expect(await actOnGame(tabA.gameId, { type: "skip" }, tabA.revision)).toEqual({ ok: false, error: "conflict" });
    expect(await loadGame(tabA.gameId)).toEqual({ ok: true, view: afterSkip.view });
  });

  it("gives `not-found` for someone else's game, a missing game, a bad id, and no cookie at all", async () => {
    const view = await started();
    const mine = new Map(state.jar);

    state.jar.clear();
    expect(await loadGame(view.gameId)).toEqual({ ok: false, error: "not-found" });
    expect(await actOnGame(view.gameId, { type: "skip" }, view.revision)).toEqual({ ok: false, error: "not-found" });

    await started(); // a second visitor, with their own cookie
    expect(await loadGame(view.gameId)).toEqual({ ok: false, error: "not-found" });
    expect(await actOnGame(view.gameId, { type: "skip" }, view.revision)).toEqual({ ok: false, error: "not-found" });

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
    expect(await actOnGame(view.gameId, { type: "skip" }, view.revision)).toMatchObject({ ok: true });
  });
});

/**
 * Acts on the game as it is now. The revision is read straight from the
 * database, not with loadGame, which would count toward the limits under test.
 */
async function actNow(gameId: string, action: unknown) {
  const { rows } = await pg.query<{ revision: number }>("SELECT revision FROM games WHERE id = $1", [gameId]);
  return actOnGame(gameId, action, rows[0]?.revision ?? 0);
}

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

    await actNow(first.gameId, { type: "reveal" });
    const second = await started();
    expect(second.gameId).not.toBe(first.gameId);
    expect(second.round).toMatchObject({ position: 1, revealLevel: 0 });
    expect(await ownGameCount()).toBe(2);
  });

  it(`never lets a player have more than ${MAX_UNFINISHED_GAMES_PER_PACK} unfinished games: the next start resumes the latest`, async () => {
    let latest = "";
    for (let i = 0; i < MAX_UNFINISHED_GAMES_PER_PACK; i++) {
      latest = (await started()).gameId;
      await actNow(latest, { type: "reveal" });
    }
    expect(await ownGameCount()).toBe(MAX_UNFINISHED_GAMES_PER_PACK);

    const resumed = await started();
    expect(resumed.gameId).toBe(latest);
    expect(resumed.round).toMatchObject({ revealLevel: 1 });
    expect(await ownGameCount()).toBe(MAX_UNFINISHED_GAMES_PER_PACK);
  });

  it("starts a new game after a finished one (Play again), even with other unfinished games", async () => {
    const view = await started();
    for (let i = 0; i < view.round!.puzzleCount; i++) {
      await actNow(view.gameId, { type: "skip" });
      await actNow(view.gameId, { type: "next" });
    }
    expect(await loadGame(view.gameId)).toMatchObject({ ok: true, view: { finished: true } });
    const again = await started();
    expect(again.gameId).not.toBe(view.gameId);
    expect(again.finished).toBe(false);
  });

  it(`still starts practice when the player has ${MAX_UNFINISHED_GAMES_PER_PACK} unfinished games of another pack`, async () => {
    const view = await started();
    const { rows } = await pg.query<{ anon_owner_hash: string; state: unknown }>(
      "SELECT anon_owner_hash, state FROM games WHERE id = $1",
      [view.gameId],
    );
    const own = rows[0]!;
    await pg.query(
      "INSERT INTO packs (id, kind, title, theme) VALUES ('pk_other_85', 'practice', 'Other', 'Mixed') ON CONFLICT DO NOTHING",
    );
    for (let i = 0; i < MAX_UNFINISHED_GAMES_PER_PACK; i++) {
      await pg.query("INSERT INTO games (pack_id, anon_owner_hash, state) VALUES ('pk_other_85', $1, $2)", [
        own.anon_owner_hash,
        JSON.stringify(own.state),
      ]);
    }
    await pg.query("DELETE FROM games WHERE id = $1", [view.gameId]);

    // Abandoned games of another pack (e.g. old daily packs) never block practice.
    const fresh = await started();
    expect(fresh.gameId).not.toBe(view.gameId);
    expect(fresh.round).toMatchObject({ position: 1, revealLevel: 0 });
    expect(await ownGameCount()).toBe(MAX_UNFINISHED_GAMES_PER_PACK + 1);

    // And the practice cap still holds on top of them.
    let latest = fresh.gameId;
    await actNow(latest, { type: "reveal" });
    for (let i = 1; i < MAX_UNFINISHED_GAMES_PER_PACK; i++) {
      latest = (await started()).gameId;
      await actNow(latest, { type: "reveal" });
    }
    expect((await started()).gameId).toBe(latest);
    expect(await ownGameCount()).toBe(2 * MAX_UNFINISHED_GAMES_PER_PACK);
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
    expect(await actNow(view.gameId, { type: "reveal" })).toEqual({ ok: false, error: "rate-limited" });
    expect(await loadGame(view.gameId)).toEqual({ ok: false, error: "rate-limited" });

    vi.setSystemTime(T0.getTime() + GAME_LIMITS.actionsPerOwner.windowMs);
    expect(await actNow(view.gameId, { type: "reveal" })).toMatchObject({ ok: true, view: { round: { revealLevel: 1 } } });
  });

  it("counts per IP from the first x-forwarded-for entry, across players, storing only keyed hashes", async () => {
    state.headers = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
    for (let i = 0; i < GAME_LIMITS.startsPerIp.max; i++) {
      state.jar.clear(); // a new anonymous player each time
      await started();
    }
    state.jar.clear();
    expect(await startPracticeGame()).toEqual({ ok: false, error: "rate-limited" });
    // The IPv4-mapped form of the same address shares its bucket.
    state.headers = { "x-forwarded-for": "::ffff:203.0.113.7" };
    expect(await startPracticeGame()).toEqual({ ok: false, error: "rate-limited" });
    // Another address behind the same proxy hop is counted on its own.
    state.headers = { "x-forwarded-for": "198.51.100.20, 10.0.0.1" };
    expect((await startPracticeGame()).ok).toBe(true);

    const { rows } = await pg.query<{ key: string }>("SELECT key FROM rate_limits WHERE key LIKE 'game:start:ip:%'");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key).join(" ")).not.toMatch(/203\.0\.113\.7|198\.51\.100\.20|10\.0\.0\.1/);
  }, 120_000);

  it("reads the address like login does: x-vercel-forwarded-for first, then x-forwarded-for, then x-real-ip", async () => {
    const ipKeys = async () =>
      (await pg.query<{ key: string }>("SELECT key FROM rate_limits WHERE key LIKE 'game:start:ip:%' ORDER BY key")).rows.map((r) => r.key);
    state.headers = { "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "192.0.2.2", "x-real-ip": "192.0.2.3" };
    await started();
    const vercelFirst = await ipKeys();
    state.headers = { "x-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.3" };
    await started();
    expect(await ipKeys()).toEqual(vercelFirst);
    state.headers = { "x-real-ip": "192.0.2.1" };
    await started();
    expect(await ipKeys()).toEqual(vercelFirst);
  });

  it("off Vercel, skips the per-IP limits for loopback or missing addresses, but still counts per player", async () => {
    vi.stubEnv("VERCEL", "");
    try {
      const cases: Record<string, string>[] = [{}, { "x-forwarded-for": "127.0.0.1" }, { "x-forwarded-for": "::1" }, { "x-forwarded-for": "::ffff:127.0.0.1" }];
      for (const headers of cases) {
        state.headers = headers;
        await started();
      }
      const { rows } = await pg.query<{ key: string }>("SELECT key FROM rate_limits ORDER BY key");
      expect(rows.map((r) => r.key)).toEqual([expect.stringMatching(/^game:start:owner:anon:[0-9a-f]{64}$/)]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("on Vercel, counts every address, and requests with none share one `unknown` bucket", async () => {
    vi.stubEnv("VERCEL", "1");
    try {
      state.headers = {};
      await started();
      state.headers = { "x-forwarded-for": "127.0.0.1" };
      await started();
      const { rows } = await pg.query<{ key: string }>("SELECT key FROM rate_limits WHERE key LIKE 'game:start:ip:%'");
      expect(rows.map((r) => r.key)).toContain("game:start:ip:unknown");
      expect(rows).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
