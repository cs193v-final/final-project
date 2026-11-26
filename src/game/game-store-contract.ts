// Shared contract tests for `GameStore` implementations (#54). Not a test file
// itself: `server-game.test.ts` runs it against `MemoryGameStore`, and
// `src/db/games.test.ts` against the Postgres store on PGlite.
import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import {
  act,
  DuplicateDailyGameError,
  GameConflictError,
  GameNotFoundError,
  getGame,
  puzzleSourceFrom,
  startGame,
  startOrResumeDaily,
  type GameDeps,
  type GameOwner,
  type GameState,
  type GameStore,
  type StoredGame,
} from "./server-game.ts";
import type { Pack, Puzzle, TimedScoringConfig } from "./types.ts";

export type GameStoreContext = {
  store: GameStore;
  /** Two different owners the store accepts (e.g. existing users, or hashed anon ids). */
  alice: GameOwner;
  bob: GameOwner;
  /** A pack id the store accepts (e.g. one with a `packs` row). */
  packId: string;
  /** An id in the store's format that no game has. */
  missingId: string;
};

const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

/** A clock the tests move by hand (ms), so timed rounds don't depend on the real time. */
function fakeClock(start = Date.UTC(2030, 0, 1, 12)) {
  let now = start;
  return { now: () => now, advance: (seconds: number) => (now += seconds * 1000) };
}

/** Opaque copies of the sample puzzles, so stored state never names an answer. */
export const CONTRACT_PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));

function state(packId: string, overrides: Partial<GameState> = {}): GameState {
  return {
    schemaVersion: 2,
    pack: { id: packId, kind: "practice", title: "Practice", theme: "Mixed" },
    puzzleIds: CONTRACT_PUZZLES.map((p) => p.id),
    scoring: CONFIG,
    index: 0,
    round: { puzzleId: "p1", state: "ready", startedAt: null, wrongGuesses: 0 },
    finished: false,
    events: [],
    lastOutcome: null,
    ...overrides,
  };
}

/** Two consecutive days no other test has used, since a store may be shared by the tests of one file. */
let dayCounter = 0;
function freshDays(): [string, string] {
  const day = Date.UTC(2030, 0, 1) + dayCounter++ * 2 * 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return [iso(day), iso(day + 86_400_000)];
}

export function describeGameStoreContract(name: string, setup: () => Promise<GameStoreContext>): void {
  describe(`GameStore contract: ${name}`, () => {
    it("create gives a fresh id and revision 0, and get returns the same record", async () => {
      const { store, alice, packId } = await setup();
      const a = await store.create({ owner: alice, packId, state: state(packId) });
      const b = await store.create({ owner: alice, packId, state: state(packId) });
      expect(a.id).not.toBe(b.id);
      expect(a).toEqual({ id: a.id, owner: alice, packId, revision: 0, state: state(packId) });
      expect(await store.get(a.id)).toEqual(a);
    });

    it("get returns null for an unknown or malformed id", async () => {
      const { store, missingId } = await setup();
      expect(await store.get(missingId)).toBeNull();
      expect(await store.get("not-a-game")).toBeNull();
      expect(await store.get("")).toBeNull();
    });

    it("save replaces the state, bumps the revision and keeps owner and pack", async () => {
      const { store, alice, bob, packId } = await setup();
      const created = await store.create({ owner: alice, packId, state: state(packId) });
      const next = state(packId, { events: [{ type: "timeOut", puzzleId: "p1" }], round: { ...created.state.round, state: "timedOut", startedAt: 1 } });
      const saved = await store.save({ ...created, owner: bob, state: next });
      expect(saved).toEqual({ ...created, revision: 1, state: next });
      expect(await store.get(created.id)).toEqual(saved);
      expect((await store.save(saved)).revision).toBe(2);
    });

    it("a stale save throws GameConflictError and changes nothing", async () => {
      const { store, alice, packId } = await setup();
      const created = await store.create({ owner: alice, packId, state: state(packId) });
      const first = await store.save({ ...created, state: state(packId, { index: 0, lastOutcome: { kind: "empty" } }) });
      await expect(store.save({ ...created, state: state(packId) })).rejects.toBeInstanceOf(GameConflictError);
      expect(await store.get(created.id)).toEqual(first);
    });

    it("of two concurrent saves from the same revision, exactly one wins", async () => {
      const { store, alice, packId } = await setup();
      const created = await store.create({ owner: alice, packId, state: state(packId) });
      const results = await Promise.allSettled([
        store.save({ ...created, state: state(packId, { lastOutcome: { kind: "empty" } }) }),
        store.save({ ...created, state: state(packId, { lastOutcome: { kind: "incorrect", normalizedGuess: "x" } }) }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(GameConflictError);
      expect((await store.get(created.id))?.revision).toBe(1);
    });

    it("saving a game that doesn't exist throws GameNotFoundError", async () => {
      const { store, alice, packId, missingId } = await setup();
      const ghost: StoredGame = { id: missingId, owner: alice, packId, revision: 0, state: state(packId) };
      await expect(store.save(ghost)).rejects.toBeInstanceOf(GameNotFoundError);
      // Ids come from URLs: a malformed one is a missing game too, not a database error.
      for (const id of ["not-a-game", ""]) {
        await expect(store.save({ ...ghost, id })).rejects.toBeInstanceOf(GameNotFoundError);
      }
    });

    it("returns copies: changing a returned record doesn't change the store", async () => {
      const { store, alice, packId } = await setup();
      const created = await store.create({ owner: alice, packId, state: state(packId) });
      created.state.events.push({ type: "timeOut", puzzleId: "p1" });
      created.state.round.startedAt = 3;
      expect(await store.get(created.id)).toEqual({ ...created, state: state(packId) });
    });

    it("runs a whole game through the service, owner checks included", async () => {
      const { store, alice, bob, packId } = await setup();
      const clock = fakeClock();
      const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(CONTRACT_PUZZLES), now: clock.now };
      const pack: Pack = { id: packId, kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: CONTRACT_PUZZLES.map((p) => p.id) };
      let view = await startGame(deps, pack, alice, CONFIG);
      await expect(getGame(deps, view.gameId, bob)).rejects.toBeInstanceOf(GameNotFoundError);
      await expect(act(deps, view.gameId, bob, { type: "start" }, view.revision)).rejects.toBeInstanceOf(GameNotFoundError);

      // Round 1: right at 0 s (within the grace): full points.
      view = await act(deps, view.gameId, alice, { type: "start" }, view.revision);
      view = await act(deps, view.gameId, alice, { type: "guess", guess: CONTRACT_PUZZLES[0]!.answer }, view.revision);
      // The other rounds time out.
      for (let i = 1; i < CONTRACT_PUZZLES.length; i++) {
        view = await act(deps, view.gameId, alice, { type: "next" }, view.revision);
        view = await act(deps, view.gameId, alice, { type: "start" }, view.revision);
        clock.advance(31);
        view = await getGame(deps, view.gameId, alice);
        expect(view.round?.state).toBe("timedOut");
      }
      view = await act(deps, view.gameId, alice, { type: "next" }, view.revision);
      expect(view).toMatchObject({ finished: true, round: null, total: CONFIG.maxPoints });
      expect(await getGame(deps, view.gameId, alice)).toEqual(view);
    });

    // Daily games (#58): one per owner per day.

    it("stores a daily game's day, and findDaily finds it for that owner and day only", async () => {
      const [day, nextDay] = freshDays();
      const { store, alice, bob, packId } = await setup();
      const game = await store.create({ owner: alice, packId, state: state(packId), dailyDate: day });
      expect(game.dailyDate).toBe(day);
      expect(await store.get(game.id)).toEqual(game);
      expect(await store.findDaily(alice, day)).toEqual(game);
      expect(await store.findDaily(bob, day)).toBeNull();
      expect(await store.findDaily(alice, nextDay)).toBeNull();
    });

    it("refuses a second daily game for the same owner and day, but not for another owner or day", async () => {
      const [day, nextDay] = freshDays();
      const { store, alice, bob, packId } = await setup();
      await store.create({ owner: alice, packId, state: state(packId), dailyDate: day });
      await expect(store.create({ owner: alice, packId, state: state(packId), dailyDate: day })).rejects.toBeInstanceOf(
        DuplicateDailyGameError,
      );
      await expect(store.create({ owner: bob, packId, state: state(packId), dailyDate: day })).resolves.toBeDefined();
      await expect(store.create({ owner: alice, packId, state: state(packId), dailyDate: nextDay })).resolves.toBeDefined();
    });

    it("leaves other games out of it: no day, not found by findDaily, any number per owner", async () => {
      const [day] = freshDays();
      const { store, alice, packId } = await setup();
      const a = await store.create({ owner: alice, packId, state: state(packId) });
      await store.create({ owner: alice, packId, state: state(packId) });
      expect(a).not.toHaveProperty("dailyDate");
      expect(await store.findDaily(alice, day)).toBeNull();
    });

    it("keeps the day through saves", async () => {
      const [day] = freshDays();
      const { store, alice, packId } = await setup();
      const game = await store.create({ owner: alice, packId, state: state(packId), dailyDate: day });
      const saved = await store.save({ ...game, state: state(packId, { index: 1 }) });
      expect(saved.dailyDate).toBe(day);
      expect((await store.findDaily(alice, day))!.revision).toBe(1);
    });

    it("startOrResumeDaily starts once, then resumes the same game, also when two start at once", async () => {
      const [day, nextDay] = freshDays();
      const { store, alice, bob, packId } = await setup();
      const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(CONTRACT_PUZZLES), now: fakeClock().now };
      const pack: Pack = { id: packId, kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: CONTRACT_PUZZLES.map((p) => p.id) };

      const [first, second] = await Promise.all([
        startOrResumeDaily(deps, pack, day, alice, CONFIG),
        startOrResumeDaily(deps, pack, day, alice, CONFIG),
      ]);
      expect(second.gameId).toBe(first.gameId);

      const moved = await act(deps, first.gameId, alice, { type: "start" }, first.revision);
      const resumed = await startOrResumeDaily(deps, pack, day, alice, CONFIG);
      expect(resumed).toEqual(moved);

      const bobs = await startOrResumeDaily(deps, pack, day, bob, CONFIG);
      expect(bobs.gameId).not.toBe(first.gameId);
      const tomorrow = await startOrResumeDaily(deps, pack, nextDay, alice, CONFIG);
      expect(tomorrow.gameId).not.toBe(first.gameId);
    });

    it("startOrResumeDaily returns a finished daily game as it is, with no new game", async () => {
      const [day] = freshDays();
      const { store, alice, packId } = await setup();
      const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(CONTRACT_PUZZLES), now: fakeClock().now };
      const pack: Pack = { id: packId, kind: "daily", title: "Fruit", theme: "Fruit", puzzleIds: CONTRACT_PUZZLES.map((p) => p.id) };
      let view = await startOrResumeDaily(deps, pack, day, alice, CONFIG);
      for (const puzzle of CONTRACT_PUZZLES) {
        view = await act(deps, view.gameId, alice, { type: "start" }, view.revision);
        view = await act(deps, view.gameId, alice, { type: "guess", guess: puzzle.answer }, view.revision);
        view = await act(deps, view.gameId, alice, { type: "next" }, view.revision);
      }
      expect(view.finished).toBe(true);
      expect(await startOrResumeDaily(deps, pack, day, alice, CONFIG)).toEqual(view);
    });

    it("only a daily pack can be a daily game", async () => {
      const [day] = freshDays();
      const { store, alice, packId } = await setup();
      const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(CONTRACT_PUZZLES) };
      const practice: Pack = { id: packId, kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: CONTRACT_PUZZLES.map((p) => p.id) };
      await expect(startOrResumeDaily(deps, practice, day, alice, CONFIG)).rejects.toThrow("only a daily pack");
      expect(await store.findDaily(alice, day)).toBeNull();
    });
  });
}
