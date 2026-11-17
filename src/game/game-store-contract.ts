// Shared contract tests for `GameStore` implementations (#54). Not a test file
// itself: `server-game.test.ts` runs it against `MemoryGameStore`, and
// `src/db/games.test.ts` against the Postgres store on PGlite.
import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import {
  act,
  GameConflictError,
  GameNotFoundError,
  getGame,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameOwner,
  type GameState,
  type GameStore,
  type StoredGame,
} from "./server-game.ts";
import type { Pack, Puzzle, ScoringConfig } from "./types.ts";

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

const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };

/** Opaque copies of the sample puzzles, so stored state never names an answer. */
export const CONTRACT_PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));

function state(packId: string, overrides: Partial<GameState> = {}): GameState {
  return {
    schemaVersion: 1,
    pack: { id: packId, kind: "practice", title: "Practice", theme: "Mixed" },
    puzzleIds: CONTRACT_PUZZLES.map((p) => p.id),
    scoring: CONFIG,
    index: 0,
    round: { puzzleId: "p1", state: "playing", revealLevel: 0, maxRevealLevel: 3, wrongGuesses: 0 },
    finished: false,
    events: [],
    lastOutcome: null,
    ...overrides,
  };
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
      const next = state(packId, { events: [{ type: "skip", puzzleId: "p1" }], round: { ...created.state.round, state: "skipped" } });
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
    });

    it("returns copies: changing a returned record doesn't change the store", async () => {
      const { store, alice, packId } = await setup();
      const created = await store.create({ owner: alice, packId, state: state(packId) });
      created.state.events.push({ type: "skip", puzzleId: "p1" });
      created.state.round.revealLevel = 3;
      expect(await store.get(created.id)).toEqual({ ...created, state: state(packId) });
    });

    it("runs a whole game through the service, owner checks included", async () => {
      const { store, alice, bob, packId } = await setup();
      const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(CONTRACT_PUZZLES) };
      const pack: Pack = { id: packId, kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: CONTRACT_PUZZLES.map((p) => p.id) };
      let view = await startGame(deps, pack, alice, CONFIG);
      await expect(getGame(deps, view.gameId, bob)).rejects.toBeInstanceOf(GameNotFoundError);
      await expect(act(deps, view.gameId, bob, { type: "skip" })).rejects.toBeInstanceOf(GameNotFoundError);

      view = await act(deps, view.gameId, alice, { type: "reveal" });
      view = await act(deps, view.gameId, alice, { type: "guess", guess: CONTRACT_PUZZLES[0]!.answer });
      for (let i = 1; i < CONTRACT_PUZZLES.length; i++) {
        view = await act(deps, view.gameId, alice, { type: "next" });
        view = await act(deps, view.gameId, alice, { type: "skip" });
      }
      view = await act(deps, view.gameId, alice, { type: "next" });
      expect(view).toMatchObject({ finished: true, round: null, total: 80 });
      expect(await getGame(deps, view.gameId, alice)).toEqual(view);
    });
  });
}
