// Boundary cases of the game server functions (#54) that server-game.test.ts
// doesn't pin down: the last round (skipped or answered), the wrong-guess floor,
// what `lastOutcome` reflects, a replayed action, and stored state the server
// can't play. Same in-memory store and fixed config as server-game.test.ts.
import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import {
  act,
  GameConflictError,
  getGame,
  MemoryGameStore,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameOwner,
  type GameState,
} from "./server-game.ts";
import type { GameAction, GameView, Pack, Puzzle, ScoringConfig } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks SCORING_CONFIG.
// skipPoints isn't 0, so a skipped round's points are visible.
const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 5 };

const ALICE: GameOwner = { userId: "alice" };

const PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));
const PACK: Pack = { id: "practice", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: PUZZLES.map((p) => p.id) };
const LAST = PUZZLES.length - 1;

/** A guess that is wrong for every sample and isn't a substring of any answer. */
const WRONG = "zzz definitely wrong";

function setup() {
  let n = 0;
  const store = new MemoryGameStore(() => `game-${++n}`);
  const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(PUZZLES) };
  return { store, deps };
}

async function play(deps: GameDeps, view: GameView, action: GameAction): Promise<GameView> {
  return act(deps, view.gameId, ALICE, action, view.revision);
}

/** A started game with every round but the last skipped, now playing the last round. */
async function atLastRound() {
  const s = setup();
  let view = await startGame(s.deps, PACK, ALICE, CONFIG);
  for (let i = 0; i < LAST; i++) {
    view = await play(s.deps, view, { type: "skip" });
    view = await play(s.deps, view, { type: "next" });
  }
  expect(view.round).toMatchObject({ position: PUZZLES.length, state: "playing" });
  return { ...s, view };
}

describe("the last round", () => {
  it("skipped: shows only that round's answer, keeps the game open until `next`, then finishes with skipPoints", async () => {
    const { deps, store, view: last } = await atLastRound();
    const skipped = await play(deps, last, { type: "skip" });

    // The round is over, so its answer and credit are shown, but the game isn't finished yet.
    expect(skipped.finished).toBe(false);
    expect(skipped.round).toMatchObject({
      position: PUZZLES.length,
      state: "skipped",
      answer: PUZZLES[LAST]!.answer,
      credit: PUZZLES[LAST]!.credit,
    });
    expect(skipped).not.toHaveProperty("answers");
    expect(skipped.results).toHaveLength(PUZZLES.length);
    expect(skipped.results.at(-1)).toMatchObject({ puzzleId: PUZZLES[LAST]!.id, outcome: "skipped", points: CONFIG.skipPoints });

    // A second skip, a reveal or a guess on the ended round change nothing.
    const raw = store.raw(last.gameId);
    for (const action of [{ type: "skip" }, { type: "reveal" }, { type: "guess", guess: PUZZLES[LAST]!.answer }] as const) {
      expect(await play(deps, skipped, action)).toEqual(skipped);
    }
    expect(store.raw(last.gameId)).toBe(raw);

    const finished = await play(deps, skipped, { type: "next" });
    expect(finished).toMatchObject({ finished: true, round: null, total: PUZZLES.length * CONFIG.skipPoints });
    expect(finished.results.map((r) => r.outcome)).toEqual(PUZZLES.map(() => "skipped"));
    expect(finished.answers).toEqual(PUZZLES.map((p) => p.answer));
    expect(finished).not.toHaveProperty("lastOutcome");
  });

  it("answered with an accepted alternate: the canonical answer is shown, and the finished game scores it", async () => {
    const { deps, view: last } = await atLastRound();
    const alternate = PUZZLES[LAST]!.acceptedAnswers[0];
    if (alternate === undefined) throw new Error("the last sample puzzle needs an accepted answer for this test");

    const answered = await play(deps, last, { type: "guess", guess: alternate });
    expect(answered.finished).toBe(false);
    expect(answered.lastOutcome).toEqual({ kind: "correct", matched: PUZZLES[LAST]!.answer });
    // As a whole JSON string: the alternate may be part of the canonical answer ("Golden Gate").
    expect(JSON.stringify(answered)).not.toContain(JSON.stringify(alternate));

    const finished = await play(deps, answered, { type: "next" });
    expect(finished.finished).toBe(true);
    expect(finished.results.at(-1)).toMatchObject({ outcome: "correct", points: CONFIG.basePoints });
    expect(finished.total).toBe(LAST * CONFIG.skipPoints + CONFIG.basePoints);
    // `answers` is the canonical list; the alternate the player typed never leaves the server.
    expect(JSON.stringify(finished)).not.toContain(JSON.stringify(alternate));
  });
});

describe("many wrong guesses", () => {
  it("are all counted, but never take the points below minPoints, and a late correct answer still scores minPoints", async () => {
    const { deps } = setup();
    let view = await startGame(deps, PACK, ALICE, CONFIG);
    // Enough misses to go well past the floor: (100 - 10) / 10 = 9 reach it.
    const misses = 2 * ((CONFIG.basePoints - CONFIG.minPoints) / CONFIG.wrongGuessPenalty);
    for (let i = 1; i <= misses; i++) {
      view = await play(deps, view, { type: "guess", guess: WRONG });
      expect(view.round!.wrongGuesses).toBe(i);
      expect(view.round!.pointsAvailable).toBe(Math.max(CONFIG.minPoints, CONFIG.basePoints - i * CONFIG.wrongGuessPenalty));
      expect(view.round!.state).toBe("playing"); // wrong guesses never end the round on their own
    }
    view = await play(deps, view, { type: "guess", guess: PUZZLES[0]!.answer });
    expect(view.results).toEqual([
      expect.objectContaining({ outcome: "correct", wrongGuesses: misses, points: CONFIG.minPoints }),
    ]);
    expect(view.total).toBe(CONFIG.minPoints);
  });
  // The per-round cap on wrong guesses (#209) is tested in server-game.guess-cap.test.ts.
});

describe("lastOutcome is the outcome of the last accepted action only", () => {
  it("survives a rejected action, and is cleared by an accepted one that isn't a guess", async () => {
    const { deps, store } = setup();
    let view = await startGame(deps, PACK, ALICE, CONFIG);
    expect(view).not.toHaveProperty("lastOutcome");

    view = await play(deps, view, { type: "guess", guess: WRONG });
    expect(view.lastOutcome).toEqual({ kind: "incorrect", normalizedGuess: WRONG });

    // A blank guess is rejected (not a wrong guess): nothing is saved, and the last outcome stays.
    const raw = store.raw(view.gameId);
    expect(await play(deps, view, { type: "guess", guess: "   " })).toEqual(view);
    expect(store.raw(view.gameId)).toBe(raw);

    view = await play(deps, view, { type: "reveal" });
    expect(view).not.toHaveProperty("lastOutcome");
    expect(view.round).toMatchObject({ revealLevel: 1, wrongGuesses: 1 });
  });
});

describe("a replayed action (the same request sent twice, e.g. a retry after a lost response)", () => {
  it.each<[string, GameAction]>([
    ["wrong guess", { type: "guess", guess: WRONG }],
    ["correct guess", { type: "guess", guess: PUZZLES[0]!.answer }],
    ["reveal", { type: "reveal" }],
  ])("%s: applied once; the replay gets GameConflictError and changes nothing", async (_name, action) => {
    const { deps, store } = setup();
    const start = await startGame(deps, PACK, ALICE, CONFIG);
    const first = await act(deps, start.gameId, ALICE, action, start.revision);
    const raw = store.raw(start.gameId);

    await expect(act(deps, start.gameId, ALICE, action, start.revision)).rejects.toBeInstanceOf(GameConflictError);
    expect(store.raw(start.gameId)).toBe(raw);
    const stored = (await store.get(start.gameId))!;
    expect(stored.revision).toBe(1);
    expect(stored.state.events).toHaveLength(1);
    expect(await getGame(deps, start.gameId, ALICE)).toEqual(first);
  });
});

describe("stored state the server can't play", () => {
  it("refuses a game with an unknown schemaVersion on every read and never overwrites it", async () => {
    const { deps, store } = setup();
    const view = await startGame(deps, PACK, ALICE, CONFIG);
    const stored = (await store.get(view.gameId))!;
    // A row written by a newer version of the app (or damaged): the shape may have changed.
    const future = { ...stored.state, schemaVersion: 2 } as unknown as GameState;
    await store.save({ ...stored, state: future });
    const raw = store.raw(view.gameId);

    await expect(getGame(deps, view.gameId, ALICE)).rejects.toThrow(/unsupported schemaVersion 2/);
    await expect(act(deps, view.gameId, ALICE, { type: "skip" }, 1)).rejects.toThrow(/unsupported schemaVersion 2/);
    expect(store.raw(view.gameId)).toBe(raw);
  });

  it("refuses a game whose puzzles are gone from the source, without saving a move", async () => {
    const { deps, store } = setup();
    const view = await startGame(deps, PACK, ALICE, CONFIG);
    const raw = store.raw(view.gameId);
    // The pack's last puzzle was removed (e.g. taken down) after the game started.
    const shrunk: GameDeps = { ...deps, puzzles: puzzleSourceFrom(PUZZLES.slice(0, LAST)) };

    await expect(getGame(shrunk, view.gameId, ALICE)).rejects.toThrow(/no puzzle/);
    await expect(act(shrunk, view.gameId, ALICE, { type: "skip" }, view.revision)).rejects.toThrow(/no puzzle/);
    expect(store.raw(view.gameId)).toBe(raw);
  });
});
