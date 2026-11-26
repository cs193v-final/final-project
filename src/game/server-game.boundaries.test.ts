// Boundary cases of the game server functions (#54; timed rounds, #255) that
// server-game.test.ts doesn't pin down: the last round (timed out or
// answered), many wrong guesses, what `lastOutcome` reflects, a replayed
// action, and stored state the server can't play. Same in-memory store, fake
// clock and fixed config as server-game.test.ts.
import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import { START_GRACE_SECONDS } from "./round.ts";
import { scoreAt } from "./scoring.ts";
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
import type { GameAction, GameView, Pack, Puzzle, TimedScoringConfig } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

const ALICE: GameOwner = { userId: "alice" };

const PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));
const PACK: Pack = { id: "practice", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: PUZZLES.map((p) => p.id) };
const LAST = PUZZLES.length - 1;

/** A guess that is wrong for every sample and isn't a substring of any answer. */
const WRONG = "zzz definitely wrong";

function setup() {
  let n = 0;
  let now = Date.UTC(2030, 0, 1, 12);
  const store = new MemoryGameStore(() => `game-${++n}`);
  const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(PUZZLES), now: () => now };
  /** Move the server's clock on by `seconds`. */
  const advance = (seconds: number) => {
    now += seconds * 1000;
  };
  return { store, deps, advance };
}

async function play(deps: GameDeps, view: GameView, action: GameAction): Promise<GameView> {
  return act(deps, view.gameId, ALICE, action, view.revision);
}

/** A game with its first round started (round time -START_GRACE_SECONDS). */
async function started() {
  const s = setup();
  const view = await play(s.deps, await startGame(s.deps, PACK, ALICE, CONFIG), { type: "start" });
  return { ...s, view };
}

/** A game with every round but the last timed out, now at the last round, ready. */
async function atLastRound() {
  const s = setup();
  let view = await startGame(s.deps, PACK, ALICE, CONFIG);
  for (let i = 0; i < LAST; i++) {
    view = await play(s.deps, view, { type: "start" });
    s.advance(CONFIG.limitSeconds + 1);
    view = await play(s.deps, view, { type: "next" }); // times the round out, then moves on
  }
  expect(view.round).toMatchObject({ position: PUZZLES.length, state: "ready" });
  expect(view.results.map((r) => r.outcome)).toEqual(PUZZLES.slice(0, LAST).map(() => "timedOut"));
  return { ...s, view };
}

describe("the last round", () => {
  it("timed out: shows only that round's answer, keeps the game open until `next`, then finishes with 0 for it", async () => {
    const { deps, store, advance, view: ready } = await atLastRound();
    const last = await play(deps, ready, { type: "start" });
    advance(CONFIG.limitSeconds + 1);
    const timedOut = await getGame(deps, last.gameId, ALICE);

    // The round is over, so its answer and credit are shown, but the game isn't finished yet.
    expect(timedOut.finished).toBe(false);
    expect(timedOut.round).toMatchObject({
      position: PUZZLES.length,
      state: "timedOut",
      elapsedSeconds: CONFIG.limitSeconds,
      answer: PUZZLES[LAST]!.answer,
      credit: PUZZLES[LAST]!.credit,
    });
    expect(timedOut).not.toHaveProperty("answers");
    expect(timedOut.results).toHaveLength(PUZZLES.length);
    expect(timedOut.results.at(-1)).toMatchObject({ puzzleId: PUZZLES[LAST]!.id, outcome: "timedOut", points: 0 });

    // A start or a guess (even the right one) on the ended round change nothing.
    const raw = store.raw(last.gameId);
    for (const action of [{ type: "start" }, { type: "guess", guess: PUZZLES[LAST]!.answer }] as const) {
      expect(await play(deps, timedOut, action)).toEqual(timedOut);
    }
    expect(store.raw(last.gameId)).toBe(raw);

    const finished = await play(deps, timedOut, { type: "next" });
    expect(finished).toMatchObject({ finished: true, round: null, total: 0 });
    expect(finished.results.map((r) => r.outcome)).toEqual(PUZZLES.map(() => "timedOut"));
    expect(finished.answers).toEqual(PUZZLES.map((p) => p.answer));
    expect(finished).not.toHaveProperty("lastOutcome");
  });

  it("answered with an accepted alternate: the canonical answer is shown, and the finished game scores it by time", async () => {
    const { deps, advance, view: ready } = await atLastRound();
    const alternate = PUZZLES[LAST]!.acceptedAnswers[0];
    if (alternate === undefined) throw new Error("the last sample puzzle needs an accepted answer for this test");

    const last = await play(deps, ready, { type: "start" });
    advance(5 + START_GRACE_SECONDS);
    const answered = await play(deps, last, { type: "guess", guess: alternate });
    expect(answered.finished).toBe(false);
    expect(answered.lastOutcome).toEqual({ kind: "correct", matched: PUZZLES[LAST]!.answer });
    // As a whole JSON string: the alternate may be part of the canonical answer ("Golden Gate").
    expect(JSON.stringify(answered)).not.toContain(JSON.stringify(alternate));

    const finished = await play(deps, answered, { type: "next" });
    expect(finished.finished).toBe(true);
    expect(finished.results.at(-1)).toMatchObject({ outcome: "correct", seconds: 5, points: scoreAt(5, CONFIG) });
    expect(finished.total).toBe(scoreAt(5, CONFIG)); // the timed-out rounds scored 0
    // `answers` is the canonical list; the alternate the player typed never leaves the server.
    expect(JSON.stringify(finished)).not.toContain(JSON.stringify(alternate));
  });
});

describe("many wrong guesses", () => {
  it("are all counted, never end the round, and cost nothing: a late correct answer scores by its time alone", async () => {
    const { deps, advance, view: start } = await started();
    let view = start;
    const misses = 20;
    for (let i = 1; i <= misses; i++) {
      advance(0.5);
      view = await play(deps, view, { type: "guess", guess: WRONG });
      expect(view.round!.wrongGuesses).toBe(i);
      expect(view.round!.state).toBe("playing"); // wrong guesses never end the round on their own
    }
    const seconds = misses * 0.5 - START_GRACE_SECONDS;
    view = await play(deps, view, { type: "guess", guess: PUZZLES[0]!.answer });
    expect(view.results).toEqual([
      expect.objectContaining({ outcome: "correct", wrongGuesses: misses, seconds, points: scoreAt(seconds, CONFIG) }),
    ]);
    expect(view.total).toBe(scoreAt(seconds, CONFIG));
  });
  // The per-round cap on wrong guesses (#209) is tested in server-game.guess-cap.test.ts.
});

describe("lastOutcome is the outcome of the last accepted action only", () => {
  it("survives a rejected action, and is cleared by an accepted one that isn't a guess", async () => {
    const { deps, store } = setup();
    let view = await startGame(deps, PACK, ALICE, CONFIG);
    expect(view).not.toHaveProperty("lastOutcome");
    view = await play(deps, view, { type: "start" });
    expect(view).not.toHaveProperty("lastOutcome");

    view = await play(deps, view, { type: "guess", guess: WRONG });
    expect(view.lastOutcome).toEqual({ kind: "incorrect", normalizedGuess: WRONG });

    // A blank guess is rejected (not a wrong guess): nothing is saved, and the last outcome stays.
    const raw = store.raw(view.gameId);
    expect(await play(deps, view, { type: "guess", guess: "   " })).toEqual(view);
    expect(store.raw(view.gameId)).toBe(raw);

    view = await play(deps, view, { type: "guess", guess: PUZZLES[0]!.answer });
    expect(view.lastOutcome).toEqual({ kind: "correct", matched: PUZZLES[0]!.answer });

    view = await play(deps, view, { type: "next" });
    expect(view).not.toHaveProperty("lastOutcome");
    expect(view.round).toMatchObject({ position: 2, state: "ready", wrongGuesses: 0 });
  });
});

describe("a replayed action (the same request sent twice, e.g. a retry after a lost response)", () => {
  it.each<[string, GameAction, boolean]>([
    ["start", { type: "start" }, false],
    ["wrong guess", { type: "guess", guess: WRONG }, true],
    ["correct guess", { type: "guess", guess: PUZZLES[0]!.answer }, true],
  ])("%s: applied once; the replay gets GameConflictError and changes nothing", async (_name, action, afterStart) => {
    const s = setup();
    const ready = await startGame(s.deps, PACK, ALICE, CONFIG);
    const before = afterStart ? await play(s.deps, ready, { type: "start" }) : ready;
    s.advance(2);
    const first = await act(s.deps, before.gameId, ALICE, action, before.revision);
    const raw = s.store.raw(before.gameId);

    await expect(act(s.deps, before.gameId, ALICE, action, before.revision)).rejects.toBeInstanceOf(GameConflictError);
    expect(s.store.raw(before.gameId)).toBe(raw);
    const stored = (await s.store.get(before.gameId))!;
    expect(stored.revision).toBe(before.revision + 1);
    expect(stored.state.events).toHaveLength(afterStart ? 1 : 0); // `start` emits no scoring event
    expect(await getGame(s.deps, before.gameId, ALICE)).toEqual(first);
  });
});

describe("stored state the server can't play", () => {
  it("refuses a game with an unknown (future) schemaVersion on every read and never overwrites it", async () => {
    const { deps, store } = setup();
    const view = await startGame(deps, PACK, ALICE, CONFIG);
    const stored = (await store.get(view.gameId))!;
    // A row written by a newer version of the app (or damaged): the shape may have changed.
    // Version 2 is the current one (timed rounds); 1 is the old rules, tested in server-game.test.ts.
    const future = { ...stored.state, schemaVersion: 3 } as unknown as GameState;
    await store.save({ ...stored, state: future });
    const raw = store.raw(view.gameId);

    await expect(getGame(deps, view.gameId, ALICE)).rejects.toThrow(/unsupported schemaVersion 3/);
    await expect(act(deps, view.gameId, ALICE, { type: "start" }, 1)).rejects.toThrow(/unsupported schemaVersion 3/);
    expect(store.raw(view.gameId)).toBe(raw);
  });

  it("refuses a game whose puzzles are gone from the source, without saving a move", async () => {
    const { deps, store } = setup();
    const view = await startGame(deps, PACK, ALICE, CONFIG);
    const raw = store.raw(view.gameId);
    // The pack's last puzzle was removed (e.g. taken down) after the game started.
    const shrunk: GameDeps = { ...deps, puzzles: puzzleSourceFrom(PUZZLES.slice(0, LAST)) };

    await expect(getGame(shrunk, view.gameId, ALICE)).rejects.toThrow(/no puzzle/);
    await expect(act(shrunk, view.gameId, ALICE, { type: "start" }, view.revision)).rejects.toThrow(/no puzzle/);
    expect(store.raw(view.gameId)).toBe(raw);
  });
});
