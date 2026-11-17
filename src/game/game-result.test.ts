import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGameCall } from "./game-result.ts";
import { errorForLog, type LoggedError } from "./log-safe.ts";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import {
  act,
  GameConflictError,
  GameNotFoundError,
  getGame,
  InvalidGameActionError,
  MemoryGameStore,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameStore,
  type StoredGame,
} from "./server-game.ts";
import type { GameAction, GameView, Pack, ScoringConfig } from "./types.ts";

const VIEW: GameView = {
  gameId: "g1",
  pack: { id: "pk", kind: "practice", title: "Practice", theme: "Mixed" },
  round: null,
  results: [],
  total: 0,
  finished: true,
};

const QUERY = 'select "state" from "games" where "anon_owner_hash" = $1 and "id" = $2';
const OWNER_HASH = "a".repeat(64);
const GUESS = "my secret guess";

/** A failed drizzle query whose Postgres error quotes one of its values in the message. */
function failedQuery(): DrizzleQueryError {
  const postgres = Object.assign(new Error(`invalid input syntax for type uuid: "${GUESS}"`), {
    name: "NeonDbError",
    code: "22P02",
  });
  return new DrizzleQueryError(QUERY, [OWNER_HASH, GUESS], postgres);
}

describe("runGameCall", () => {
  it("returns the view when the call succeeds", async () => {
    expect(await runGameCall(async () => VIEW)).toEqual({ ok: true, view: VIEW });
  });

  it("maps not found / not yours and invalid actions to codes, without messages", async () => {
    const log = vi.fn();
    expect(await runGameCall(() => Promise.reject(new GameNotFoundError()), log)).toEqual({ ok: false, error: "not-found" });
    expect(await runGameCall(() => Promise.reject(new InvalidGameActionError("unknown type")), log)).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("reports a conflict without running the call again", async () => {
    const call = vi.fn<() => Promise<GameView>>().mockRejectedValueOnce(new GameConflictError("g1")).mockResolvedValue(VIEW);
    expect(await runGameCall(call)).toEqual({ ok: false, error: "conflict" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("logs anything else on the server and returns only `unavailable`", async () => {
    const log = vi.fn<(error: LoggedError) => void>();
    const error = new TypeError("Cannot read properties of undefined (reading 'round')");
    const result = await runGameCall(() => Promise.reject(error), log);
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(log).toHaveBeenCalledWith(errorForLog(error));
    expect(log.mock.calls[0]?.[0].stack?.length).toBeGreaterThan(0);
  });

  // Whatever logger is passed, it gets the sanitized error (#60).
  it("never hands a failed query's params, or a Postgres message quoting a value, to the logger", async () => {
    const log = vi.fn<(error: LoggedError) => void>();
    await runGameCall(() => Promise.reject(failedQuery()), log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0].query).toBe(QUERY);
    const text = JSON.stringify(log.mock.calls[0]?.[0]);
    expect(text).toContain("22P02");
    for (const value of [OWNER_HASH, GUESS]) expect(text).not.toContain(value);
  });

  describe("the default logger", () => {
    afterEach(() => vi.restoreAllMocks());

    it("prints one JSON line with no param values, deep causes included", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      // DrizzleQueryError → NeonDbError → sourceError (fetch failed) → cause (ECONNREFUSED): below
      // console.error's default inspect depth, so only JSON shows it.
      const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
      const fetchFailed = new TypeError("fetch failed", { cause: refused });
      const neon = Object.assign(new Error("Error connecting to database: fetch failed"), {
        name: "NeonDbError",
        sourceError: fetchFailed,
      });
      const error = new DrizzleQueryError(QUERY, [OWNER_HASH, GUESS], neon);

      expect(await runGameCall(() => Promise.reject(error))).toEqual({ ok: false, error: "unavailable" });

      expect(consoleError).toHaveBeenCalledTimes(1);
      const printed = consoleError.mock.calls[0]!.map(String).join(" ");
      for (const value of [OWNER_HASH, GUESS]) expect(printed).not.toContain(value);
      expect(printed).toContain("ECONNREFUSED");
      expect(printed).toContain(QUERY.replaceAll('"', '\\"'));
      const json = consoleError.mock.calls[0]![1] as string;
      expect(JSON.parse(json)).toEqual(errorForLog(error));
    });
  });
});

describe("two tabs acting on the same game at once", () => {
  const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };
  const PUZZLES = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));
  const PACK: Pack = { id: "pk", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: PUZZLES.map((p) => p.id) };
  const OWNER = { anonId: "owner" };

  /** A store whose reads all wait until `readers` of them have happened, so both requests read the same revision. */
  function raceStore(inner: GameStore, readers: number): GameStore {
    let waiting: (() => void)[] = [];
    return {
      create: (game) => inner.create(game),
      save: (game: StoredGame) => inner.save(game),
      async get(id) {
        const game = await inner.get(id);
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length === readers) {
            waiting.forEach((r) => r());
            waiting = [];
          }
        });
        return game;
      },
    };
  }

  it.each<[string, GameAction]>([
    ["skip", { type: "skip" }],
    ["reveal", { type: "reveal" }],
    ["wrong guess", { type: "guess", guess: "zzz wrong" }],
  ])("%s from both: one is applied, the other gets `conflict` and isn't applied", async (_name, action) => {
    const inner = new MemoryGameStore();
    const plain: GameDeps = { games: inner, puzzles: puzzleSourceFrom(PUZZLES) };
    const { gameId } = await startGame(plain, PACK, OWNER, CONFIG);

    const racing: GameDeps = { games: raceStore(inner, 2), puzzles: plain.puzzles };
    const results = await Promise.all([
      runGameCall(() => act(racing, gameId, OWNER, action)),
      runGameCall(() => act(racing, gameId, OWNER, action)),
    ]);

    expect(results.map((r) => (r.ok ? "ok" : r.error)).sort()).toEqual(["conflict", "ok"]);
    const stored = (await inner.get(gameId))!;
    expect(stored.revision).toBe(1);
    expect(stored.state.events).toHaveLength(1); // applied exactly once
    // Still on the first image: nobody skipped (or zoomed, or guessed on) a round they hadn't seen.
    const view = await getGame(plain, gameId, OWNER);
    expect(view.round?.position).toBe(1);
  });
});
