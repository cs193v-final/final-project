import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import { describeGameStoreContract } from "./game-store-contract.ts";
import { START_GRACE_SECONDS } from "./round.ts";
import { scoreAt } from "./scoring.ts";
import { EFFECTS } from "./puzzles.ts";
import {
  act,
  DEFAULT_EFFECT,
  GameConflictError,
  GameFromOldRulesError,
  GameNotFoundError,
  GameUnreadableError,
  getGame,
  InvalidGameActionError,
  MAX_GUESS_LENGTH,
  MemoryGameStore,
  parseGameAction,
  puzzleSourceFrom,
  resumeDaily,
  startGame,
  type GameDeps,
  type GameOwner,
  type GameStore,
  type StoredGame,
} from "./server-game.ts";
import type { GameAction, GameView, Pack, Puzzle, TimedScoringConfig } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

const ALICE: GameOwner = { userId: "alice" };
const BOB: GameOwner = { userId: "bob" };

/**
 * The sample puzzles with short ids ("p1") and image paths, so stored-state
 * expectations stay readable. The real sample data (opaque ids since #52) is
 * checked too, below.
 */
const OPAQUE_SAMPLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({
  ...p,
  id: `p${i + 1}`,
  imageUrl: `/img/p${i + 1}.jpg`,
}));

function packOf(puzzles: readonly Puzzle[]): Pack {
  return { id: "practice", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: puzzles.map((p) => p.id) };
}

const T0 = Date.UTC(2030, 0, 1, 12);

/** The server's clock, moved by hand. `at(s)` sets it to `s` seconds of round time after a start at T0 (grace included). */
function fakeClock() {
  let now = T0;
  return {
    now: () => now,
    advance(seconds: number) {
      now += seconds * 1000;
    },
    /** Round time `seconds` for a round started at T0: the grace is added back. */
    at(seconds: number) {
      now = T0 + (seconds + START_GRACE_SECONDS) * 1000;
    },
  };
}

function setup(puzzles: readonly Puzzle[] = OPAQUE_SAMPLES) {
  let n = 0;
  const store = new MemoryGameStore(() => `game-${++n}`);
  const clock = fakeClock();
  const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(puzzles), now: clock.now };
  return { store, deps, clock, pack: packOf(puzzles), puzzles };
}

/** Plays a move with the revision the view shows. */
function play(deps: GameDeps, view: GameView, action: GameAction, owner: GameOwner = ALICE): Promise<GameView> {
  return act(deps, view.gameId, owner, action, view.revision);
}

/** A new game whose first round's clock started at T0. */
async function startedGame(puzzles?: readonly Puzzle[]) {
  const s = setup(puzzles);
  const view = await play(s.deps, await startGame(s.deps, s.pack, ALICE, CONFIG), { type: "start" });
  return { ...s, view };
}

/** Lowercased answer strings that must not appear in a view while a round is ready or playing. */
function secrets(puzzles: readonly Puzzle[]): string[] {
  return puzzles.flatMap((p) => [p.answer, ...p.acceptedAnswers]).map((s) => s.toLowerCase());
}

/**
 * The anti-cheat check (#54): while the round isn't over, the whole response,
 * serialized exactly as it would be sent, contains no answer or accepted
 * answer of ANY puzzle in the game (current, earlier or later), and never the
 * server's start time.
 */
function expectNoAnswers(view: GameView, puzzles: readonly Puzzle[]): void {
  const json = JSON.stringify(view);
  expect(json).not.toMatch(/acceptedAnswers|startedAt/);
  if (view.round?.state !== "playing" && view.round?.state !== "ready") return;
  expect(view.round).not.toHaveProperty("answer");
  expect(view.round).not.toHaveProperty("credit");
  const lower = json.toLowerCase();
  for (const secret of secrets(puzzles)) {
    expect(lower, `"${secret}" leaked while playing`).not.toContain(secret);
  }
}

/** A guess that is wrong for every sample and isn't a substring of any answer. */
const WRONG = "zzz definitely wrong";

describe("startGame", () => {
  it("returns the first round ready: no clock, no photo, no answer, and the game's scoring", async () => {
    const { deps, pack, puzzles } = setup();
    const view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view).toEqual({
      gameId: "game-1",
      revision: 0,
      pack: { id: "practice", kind: "practice", title: "Practice", theme: "Mixed" },
      round: {
        position: 1,
        puzzleCount: 3,
        state: "ready",
        elapsedSeconds: null,
        effect: puzzles[0]!.effect ?? DEFAULT_EFFECT,
        seed: "p1",
        focus: puzzles[0]!.reveal.focus,
        wrongGuesses: 0,
        aiSolvedLevel: puzzles[0]!.aiSolvedLevel,
      },
      results: [],
      total: 0,
      finished: false,
      scoring: CONFIG,
    });
  });

  it("rejects bad input before storing anything", async () => {
    const { deps, pack, store } = setup();
    await expect(startGame(deps, { ...pack, puzzleIds: ["p1", "nope"] }, ALICE, CONFIG)).rejects.toThrow(
      /no puzzle "nope"/,
    );
    await expect(startGame(deps, { ...pack, puzzleIds: [] }, ALICE, CONFIG)).rejects.toThrow(/at least one/);
    await expect(startGame(deps, pack, ALICE, { ...CONFIG, limitSeconds: 10 })).rejects.toThrow(/limitSeconds/);
    await expect(startGame(deps, pack, { userId: "" }, CONFIG)).rejects.toThrow(/non-empty/);
    expect(store.raw("game-1")).toBeUndefined();
  });
});

describe("start (#255)", () => {
  it("starts the clock on the server's time and sends the photo", async () => {
    const { deps, pack, store, puzzles, clock } = setup();
    const ready = await startGame(deps, pack, ALICE, CONFIG);
    clock.advance(42); // time on the ready screen doesn't count
    const started = await play(deps, ready, { type: "start" });
    expect(started.revision).toBe(1);
    expect(started.round).toMatchObject({ state: "playing", elapsedSeconds: 0, imageSrc: puzzles[0]!.imageUrl });
    expect(JSON.parse(store.raw(started.gameId)!).state.round.startedAt).toBe(clock.now());
  });

  it("is refused while the clock runs, so it can't be restarted for a better time", async () => {
    const { deps, store, clock, view } = await startedGame();
    clock.at(10);
    const before = store.raw(view.gameId);
    const again = await play(deps, view, { type: "start" });
    expect(again.revision).toBe(view.revision);
    expect(again.round?.elapsedSeconds).toBe(10);
    expect(store.raw(view.gameId)).toBe(before);
  });

  it("reports the server's elapsed time in every view while playing", async () => {
    const { deps, clock, view } = await startedGame();
    clock.at(6.2);
    expect((await getGame(deps, view.gameId, ALICE)).round?.elapsedSeconds).toBe(6.2);
    clock.at(12);
    const wrong = await play(deps, view, { type: "guess", guess: WRONG });
    expect(wrong.round).toMatchObject({ state: "playing", elapsedSeconds: 12, wrongGuesses: 1 });
  });
});

describe("no photo before start (#255)", () => {
  it("sends no image URL while the round is ready, on any call", async () => {
    const { deps, pack, puzzles } = setup();
    const ready = await startGame(deps, pack, ALICE, CONFIG);
    const loaded = await getGame(deps, ready.gameId, ALICE);
    const refused = await play(deps, ready, { type: "guess", guess: puzzles[0]!.answer });
    for (const view of [ready, loaded, refused]) {
      expect(view.round?.state).toBe("ready");
      expect(view.round).not.toHaveProperty("imageSrc");
      for (const p of puzzles) expect(JSON.stringify(view)).not.toContain(p.imageUrl);
    }
  });

  it("sends none for the next round either, until it is started", async () => {
    const { deps, puzzles, view } = await startedGame();
    const solved = await play(deps, view, { type: "guess", guess: puzzles[0]!.answer });
    expect(solved.round?.imageSrc).toBe(puzzles[0]!.imageUrl); // the clear photo, with the answer
    const next = await play(deps, solved, { type: "next" });
    expect(next.round).toMatchObject({ position: 2, state: "ready", elapsedSeconds: null });
    expect(next.round).not.toHaveProperty("imageSrc");
    expect((await play(deps, next, { type: "start" })).round?.imageSrc).toBe(puzzles[1]!.imageUrl);
  });

  it("refuses a guess before start, and changes nothing", async () => {
    const { deps, pack, store, puzzles } = setup();
    const ready = await startGame(deps, pack, ALICE, CONFIG);
    const before = store.raw(ready.gameId);
    const view = await play(deps, ready, { type: "guess", guess: puzzles[0]!.answer });
    expect(view).toEqual(ready);
    expect(store.raw(ready.gameId)).toBe(before);
  });
});

describe("points by the server's elapsed time (#255)", () => {
  async function correctAt(seconds: number) {
    const { deps, puzzles, clock, view } = await startedGame();
    clock.at(seconds);
    return play(deps, view, { type: "guess", guess: puzzles[0]!.answer });
  }

  it("gives maxPoints for a guess within the grace for the network", async () => {
    const view = await correctAt(0);
    expect(view.results[0]).toEqual({ puzzleId: "p1", outcome: "correct", seconds: 0, wrongGuesses: 0, points: 10_000 });
    expect(view.total).toBe(10_000);
  });

  it("drains with the time: scoreAt of the server's elapsed seconds", async () => {
    for (const seconds of [1, 6.2, 12.5, 20]) {
      const view = await correctAt(seconds);
      expect(view.results[0]).toMatchObject({ outcome: "correct", seconds, points: scoreAt(seconds, CONFIG) });
      expect(view.round).toMatchObject({ state: "correct", elapsedSeconds: seconds });
    }
    expect((await correctAt(12.5)).results[0]!.points).toBe(2_575);
  });

  it("counts 0.5 s of grace from the start, for the network", async () => {
    const { deps, puzzles, clock, view } = await startedGame();
    clock.advance(START_GRACE_SECONDS + 3); // 3.5 s on the server's clock
    const solved = await play(deps, view, { type: "guess", guess: puzzles[0]!.answer });
    expect(solved.results[0]!.seconds).toBe(3);
  });

  it("gives the floor of minPoints between the clear time and the limit", async () => {
    for (const seconds of [25, 27.5, 29.99]) {
      expect((await correctAt(seconds)).results[0]).toMatchObject({ outcome: "correct", points: 100 });
    }
  });

  it("charges nothing for wrong guesses, but counts them", async () => {
    const { deps, puzzles, clock, view } = await startedGame();
    clock.at(2);
    let v = await play(deps, view, { type: "guess", guess: WRONG });
    v = await play(deps, v, { type: "guess", guess: "another wrong one" });
    clock.at(5);
    v = await play(deps, v, { type: "guess", guess: puzzles[0]!.answer });
    expect(v.results[0]).toEqual({ puzzleId: "p1", outcome: "correct", seconds: 5, wrongGuesses: 2, points: scoreAt(5, CONFIG) });
  });

  it("ignores any time or score a client sends with the action", async () => {
    const { deps, puzzles, clock, view } = await startedGame();
    clock.at(20);
    const forged = { type: "guess", guess: puzzles[0]!.answer, seconds: 0, points: 10_000 } as unknown as GameAction;
    expect((await play(deps, view, forged)).results[0]).toMatchObject({ seconds: 20, points: scoreAt(20, CONFIG) });
  });

  it("uses the scoring config the game started with", async () => {
    const { deps, pack, clock } = setup();
    const flat: TimedScoringConfig = { maxPoints: 500, minPoints: 500, revealSeconds: 10, limitSeconds: 10, curve: 1 };
    let view = await startGame(deps, pack, ALICE, flat);
    view = await play(deps, view, { type: "start" });
    clock.at(9);
    view = await play(deps, view, { type: "guess", guess: OPAQUE_SAMPLES[0]!.answer });
    expect(view.results[0]!.points).toBe(500);
    expect(view.scoring).toEqual(flat);
  });
});

describe("time out (#255)", () => {
  it("at the limit, the next load ends the round with 0 points and saves it", async () => {
    const { deps, store, clock, view, puzzles } = await startedGame();
    clock.at(30);
    const loaded = await getGame(deps, view.gameId, ALICE);
    expect(loaded.revision).toBe(view.revision + 1);
    expect(loaded.round).toMatchObject({ state: "timedOut", elapsedSeconds: 30, answer: puzzles[0]!.answer });
    expect(loaded.results[0]).toEqual({ puzzleId: "p1", outcome: "timedOut", seconds: 30, wrongGuesses: 0, points: 0 });
    expect(JSON.parse(store.raw(view.gameId)!).state.round.state).toBe("timedOut");
    // Loading again changes nothing more.
    clock.advance(60);
    expect(await getGame(deps, view.gameId, ALICE)).toEqual(loaded);
  });

  it("refuses a guess after the limit, even a correct one: the round shows as timed out", async () => {
    const { deps, store, clock, view, puzzles } = await startedGame();
    clock.at(1);
    const wrong = await play(deps, view, { type: "guess", guess: WRONG });
    clock.at(30.5);
    const late = await play(deps, wrong, { type: "guess", guess: puzzles[0]!.answer });
    expect(late.round).toMatchObject({ state: "timedOut", wrongGuesses: 1 });
    expect(late.results[0]).toMatchObject({ outcome: "timedOut", points: 0, wrongGuesses: 1 });
    expect(late.total).toBe(0);
    expect(late).not.toHaveProperty("lastOutcome"); // the guess wasn't checked
    expect(late.revision).toBe(wrong.revision + 1); // the time-out was saved
    const stored = JSON.parse(store.raw(view.gameId)!).state;
    expect(stored.events).toEqual([
      { type: "wrongGuess", puzzleId: "p1" },
      { type: "timeOut", puzzleId: "p1" },
    ]);
  });

  it("lets the player move on after a time-out", async () => {
    const { deps, clock, view } = await startedGame();
    clock.at(40);
    const next = await play(deps, view, { type: "next" });
    expect(next.round).toMatchObject({ position: 2, state: "ready" });
    expect(next.results).toHaveLength(1);
  });

  it("never ends a round that hasn't started, however long it waits", async () => {
    const { deps, pack, clock } = setup();
    const ready = await startGame(deps, pack, ALICE, CONFIG);
    clock.advance(3600);
    expect(await getGame(deps, ready.gameId, ALICE)).toEqual(ready);
  });

  it("keeps the round playing just before the limit", async () => {
    const { deps, clock, view } = await startedGame();
    clock.at(29.9);
    expect((await getGame(deps, view.gameId, ALICE)).round).toMatchObject({ state: "playing", elapsedSeconds: 29.9 });
  });

  it("if another request saves first while a load ends the round, shows the game as it is now", async () => {
    const { deps, store, clock, view } = await startedGame();
    clock.at(31);
    // A store whose next save loses the race to a time-out saved by "another tab".
    let raced = false;
    const racing: GameStore = {
      get: (id) => store.get(id),
      create: (g) => store.create(g),
      findDaily: (o, d) => store.findDaily(o, d),
      async save(game) {
        if (!raced) {
          raced = true;
          await store.save(game); // the other request's identical save
          throw new GameConflictError(game.id);
        }
        return store.save(game);
      },
    };
    const loaded = await getGame({ ...deps, games: racing }, view.gameId, ALICE);
    expect(loaded.round?.state).toBe("timedOut");
    expect(loaded.revision).toBe(view.revision + 1);
  });
});

describe("a full game played through", () => {
  it("ends finished, with each round's time and points, and the total", async () => {
    const { deps, pack, clock, puzzles } = setup();
    let view = await startGame(deps, pack, ALICE, CONFIG);
    // Round 1: right at 2 s.
    view = await play(deps, view, { type: "start" });
    clock.at(2);
    view = await play(deps, view, { type: "guess", guess: puzzles[0]!.answer });
    view = await play(deps, view, { type: "next" });
    // Round 2: a wrong guess, then time's up.
    view = await play(deps, view, { type: "start" });
    clock.advance(1);
    view = await play(deps, view, { type: "guess", guess: WRONG });
    clock.advance(40);
    view = await getGame(deps, view.gameId, ALICE);
    view = await play(deps, view, { type: "next" });
    // Round 3: right at 26 s (after the clear time).
    view = await play(deps, view, { type: "start" });
    clock.advance(26 + START_GRACE_SECONDS);
    view = await play(deps, view, { type: "guess", guess: puzzles[2]!.answer });
    view = await play(deps, view, { type: "next" });

    expect(view.finished).toBe(true);
    expect(view.round).toBeNull();
    expect(view.results).toEqual([
      { puzzleId: "p1", outcome: "correct", seconds: 2, wrongGuesses: 0, points: scoreAt(2, CONFIG) },
      { puzzleId: "p2", outcome: "timedOut", seconds: 30, wrongGuesses: 1, points: 0 },
      { puzzleId: "p3", outcome: "correct", seconds: 26, wrongGuesses: 0, points: 100 },
    ]);
    expect(view.total).toBe(scoreAt(2, CONFIG) + 100);
    expect(view.answers).toEqual(puzzles.map((p) => p.answer));
    expect(view).not.toHaveProperty("beatAi"); // until it compares solve times (#257)
    expect(await getGame(deps, view.gameId, ALICE)).toEqual(view);
  });
});

describe("no answers reach the browser before a round is over", () => {
  it("holds for a long random sequence of actions and clock moves over many games", async () => {
    const { deps, pack, puzzles, clock } = setup();
    let seed = 255;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    // Only the current puzzle's answers: a wrong guess that happens to be
    // another puzzle's answer is echoed back as the player's own input.
    const guessesFor = (view: GameView) => {
      const p = puzzles[(view.round?.position ?? 1) - 1]!;
      return ["", WRONG, p.answer, ...p.acceptedAnswers];
    };
    const states = new Set<string>();
    for (let g = 0; g < 10; g++) {
      let view = await startGame(deps, pack, ALICE, CONFIG);
      expectNoAnswers(view, puzzles);
      for (let n = 0; n < 60 && !view.finished; n++) {
        const r = random();
        if (r < 0.1) clock.advance(random() * 40);
        const action: GameAction =
          r < 0.3
            ? { type: "start" }
            : r < 0.8
              ? { type: "guess", guess: guessesFor(view)[Math.floor(random() * 4) % guessesFor(view).length]! }
              : { type: "next" };
        view = r < 0.15 ? await getGame(deps, view.gameId, ALICE) : await play(deps, view, action);
        if (view.round) states.add(view.round.state);
        expectNoAnswers(view, puzzles);
      }
    }
    expect(states).toEqual(new Set(["ready", "playing", "correct", "timedOut"]));
  });

  it("also holds for the practice puzzles as stored in the repo", async () => {
    const { deps, pack, puzzles } = setup(SAMPLE_PUZZLES);
    let view = await startGame(deps, pack, ALICE, CONFIG);
    for (const puzzle of puzzles) {
      expectNoAnswers(view, puzzles);
      view = await play(deps, view, { type: "start" });
      expectNoAnswers(view, puzzles);
      view = await play(deps, view, { type: "guess", guess: WRONG });
      expectNoAnswers(view, puzzles);
      view = await play(deps, view, { type: "guess", guess: puzzle.acceptedAnswers[0] ?? puzzle.answer });
      view = await play(deps, view, { type: "next" });
    }
    expect(view.finished).toBe(true);
  });
});

describe("effect and focus point (#255, #258)", () => {
  it("sends the puzzle's effect, seed and focus point, and DEFAULT_EFFECT when no effect is chosen", async () => {
    const puzzles: Puzzle[] = [
      { ...OPAQUE_SAMPLES[0]!, effect: "swirl", reveal: { focus: { x: 0.25, y: 0.75 }, zoomLevels: [4, 1] } },
      { ...OPAQUE_SAMPLES[1]!, effect: undefined },
    ];
    delete puzzles[1]!.effect;
    const { deps, pack, clock } = setup(puzzles);
    let view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view.round).toMatchObject({ effect: "swirl", seed: "p1", focus: { x: 0.25, y: 0.75 } });
    view = await play(deps, view, { type: "start" });
    clock.at(31);
    view = await play(deps, view, { type: "next" });
    expect(view.round).toMatchObject({ effect: DEFAULT_EFFECT, seed: "p2", focus: puzzles[1]!.reveal.focus });
    expect(EFFECTS).toContain(DEFAULT_EFFECT);
  });
});

describe("aiSolvedLevel (#56)", () => {
  it("passes on the level the AI solved the puzzle at, and nothing else about the AI", async () => {
    const puzzles = OPAQUE_SAMPLES.map((p, i) => ({ ...p, aiSolvedLevel: i === 0 ? 2 : null }));
    const { deps, pack } = setup(puzzles);
    const view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view.round?.aiSolvedLevel).toBe(2);
  });
});

describe("images (#57): the full photo only", () => {
  /** Fake cut levels: one opaque URL per zoom level for each puzzle; the last is the full photo. */
  function levelSrcs(puzzles: readonly Puzzle[]): Map<string, string[]> {
    return new Map(
      puzzles.map((p, i) => [
        p.id,
        p.reveal.zoomLevels.map((_, level) => `/img/${String(i).padStart(2, "0")}${String(level).padStart(30, "f")}.webp`),
      ]),
    );
  }

  function withLevels(puzzles: readonly Puzzle[] = OPAQUE_SAMPLES, srcs = levelSrcs(puzzles)) {
    const base = setup(puzzles);
    const lookups: string[][] = [];
    const deps: GameDeps = {
      ...base.deps,
      levels: {
        async getLevelSrcs(ids) {
          lookups.push([...ids]);
          return new Map(ids.flatMap((id) => (srcs.has(id) ? [[id, srcs.get(id)!] as const] : [])));
        },
      },
    };
    return { ...base, deps, srcs, lookups };
  }

  it("sends only the full photo's URL once started: no other level, no original", async () => {
    const { deps, pack, srcs, puzzles } = withLevels();
    const ready = await startGame(deps, pack, ALICE, CONFIG);
    expect(ready.round).not.toHaveProperty("imageSrc");
    const view = await play(deps, ready, { type: "start" });
    const full = srcs.get("p1")!.at(-1)!;
    expect(view.round?.imageSrc).toBe(full);
    const json = JSON.stringify(view);
    for (const src of [...srcs.values()].flat()) if (src !== full) expect(json).not.toContain(src);
    for (const p of puzzles) expect(json).not.toContain(p.imageUrl);
  });

  it("looks up only the current puzzle's images, and none once the game is finished", async () => {
    const { deps, pack, lookups, clock } = withLevels();
    let view = await startGame(deps, pack, ALICE, CONFIG);
    for (let i = 0; i < 3; i++) {
      view = await play(deps, view, { type: "start" });
      clock.advance(40);
      view = await play(deps, view, { type: "next" });
    }
    expect(view.finished).toBe(true);
    expect(new Set(lookups.flat())).toEqual(new Set(["p1", "p2", "p3"]));
    expect(lookups.every((ids) => ids.length <= 1)).toBe(true);
  });

  it("sends a public practice image that isn't cut by its own URL", async () => {
    const puzzles = OPAQUE_SAMPLES.map((p) => ({ ...p, imageUrl: `/puzzles/${p.id}.jpg` }));
    const { deps, pack } = withLevels(puzzles, new Map());
    const view = await play(deps, await startGame(deps, pack, ALICE, CONFIG), { type: "start" });
    expect(view.round?.imageSrc).toBe("/puzzles/p1.jpg");
  });

  it("never links a private image that hasn't been cut: the call fails and no game is stored", async () => {
    const { deps, pack, store } = withLevels(OPAQUE_SAMPLES, new Map());
    await expect(startGame(deps, pack, ALICE, CONFIG)).rejects.toThrow(/no cut images/);
    expect(store.raw("game-1")).toBeUndefined();
  });

  it("treats a puzzle with fewer images than zoom levels as not cut", async () => {
    const srcs = levelSrcs(OPAQUE_SAMPLES);
    srcs.set("p1", srcs.get("p1")!.slice(0, 1));
    const { deps, pack } = withLevels(OPAQUE_SAMPLES, srcs);
    await expect(startGame(deps, pack, ALICE, CONFIG)).rejects.toThrow(/no cut images/);
  });

  it("doesn't move a game on to a puzzle it can't show, so the game stays playable", async () => {
    const srcs = levelSrcs(OPAQUE_SAMPLES);
    srcs.delete("p2");
    const { deps, pack, store, clock } = withLevels(OPAQUE_SAMPLES, srcs);
    let view = await play(deps, await startGame(deps, pack, ALICE, CONFIG), { type: "start" });
    clock.advance(1);
    view = await play(deps, view, { type: "guess", guess: OPAQUE_SAMPLES[0]!.answer });
    const before = store.raw(view.gameId);
    await expect(play(deps, view, { type: "next" })).rejects.toThrow(/no cut images/);
    expect(store.raw(view.gameId)).toBe(before);
    expect((await getGame(deps, view.gameId, ALICE)).round?.state).toBe("correct");
  });
});

describe("after a round ends", () => {
  it("shows the answer and credit once the round is answered", async () => {
    const { deps, view, puzzles } = await startedGame();
    const solved = await play(deps, view, { type: "guess", guess: puzzles[0]!.answer });
    expect(solved.round).toMatchObject({ state: "correct", answer: puzzles[0]!.answer, credit: puzzles[0]!.credit });
    expect(solved.lastOutcome).toEqual({ kind: "correct", matched: puzzles[0]!.answer });
  });

  it("never sends accepted answers, even when the player typed one", async () => {
    const withAlternate = OPAQUE_SAMPLES.find((p) => p.acceptedAnswers.length > 0)!;
    const { deps, view } = await startedGame([withAlternate]);
    const solved = await play(deps, view, { type: "guess", guess: withAlternate.acceptedAnswers[0]! });
    expect(solved.lastOutcome).toEqual({ kind: "correct", matched: withAlternate.answer });
    for (const alt of withAlternate.acceptedAnswers) expect(JSON.stringify(solved)).not.toContain(alt);
  });

  it("hides the answer again when the next round is ready", async () => {
    const { deps, view, puzzles } = await startedGame();
    const solved = await play(deps, view, { type: "guess", guess: puzzles[0]!.answer });
    const next = await play(deps, solved, { type: "next" });
    expect(next.round).not.toHaveProperty("answer");
    expect(next.round).not.toHaveProperty("credit");
    expectNoAnswers(next, puzzles);
  });
});

describe("ownership", () => {
  it("another owner gets GameNotFoundError from act and getGame, and the game is unchanged", async () => {
    const { deps, store, view } = await startedGame();
    const before = store.raw(view.gameId);
    await expect(getGame(deps, view.gameId, BOB)).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(play(deps, view, { type: "guess", guess: WRONG }, BOB)).rejects.toBeInstanceOf(GameNotFoundError);
    expect(store.raw(view.gameId)).toBe(before);
  });

  it("doesn't reveal whether the game exists", async () => {
    const { deps } = setup();
    await expect(getGame(deps, "no-such-game", ALICE)).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(act(deps, "no-such-game", ALICE, { type: "start" }, 0)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it("treats a user and an anonymous visitor with the same id as different owners", async () => {
    const { deps, pack } = setup();
    const view = await startGame(deps, pack, { userId: "x" }, CONFIG);
    await expect(getGame(deps, view.gameId, { anonId: "x" })).rejects.toBeInstanceOf(GameNotFoundError);
  });
});

describe("resuming after a refresh", () => {
  it("getGame returns the same view the last action did, with the clock moved on", async () => {
    const { deps, clock, view } = await startedGame();
    clock.at(3);
    const wrong = await play(deps, view, { type: "guess", guess: WRONG });
    expect(await getGame(deps, view.gameId, ALICE)).toEqual(wrong);
    clock.at(8);
    expect(await getGame(deps, view.gameId, ALICE)).toEqual({ ...wrong, round: { ...wrong.round, elapsedSeconds: 8 } });
  });
});

describe("refused actions change nothing", () => {
  it("guess and start after the round ended, next before it ended, a blank guess", async () => {
    const { deps, store, view, puzzles } = await startedGame();
    const blank = await play(deps, view, { type: "guess", guess: "   " });
    expect(blank).toEqual(view);
    expect(await play(deps, view, { type: "next" })).toEqual(view);
    const solved = await play(deps, view, { type: "guess", guess: puzzles[0]!.answer });
    const before = store.raw(view.gameId);
    for (const action of [{ type: "start" }, { type: "guess", guess: WRONG }] as const) {
      expect(await play(deps, solved, action)).toEqual(solved);
    }
    expect(store.raw(view.gameId)).toBe(before);
  });

  it("every action after the game is finished", async () => {
    const { deps, pack, clock } = setup([OPAQUE_SAMPLES[0]!]);
    let view = await play(deps, await startGame(deps, pack, ALICE, CONFIG), { type: "start" });
    clock.advance(40);
    view = await play(deps, view, { type: "next" });
    expect(view.finished).toBe(true);
    for (const action of [{ type: "start" }, { type: "guess", guess: WRONG }, { type: "next" }] as const) {
      expect(await play(deps, view, action)).toEqual(view);
    }
  });

  it("a malformed action from a client throws InvalidGameActionError", async () => {
    const { deps, view } = await startedGame();
    for (const bad of [null, "start", { type: "reveal" }, { type: "skip" }, { type: "guess" }, { type: "guess", guess: 5 }]) {
      await expect(act(deps, view.gameId, ALICE, bad as unknown as GameAction, view.revision)).rejects.toBeInstanceOf(
        InvalidGameActionError,
      );
    }
  });
});

describe("parseGameAction", () => {
  it("accepts start, guess and next and drops extra fields, so a client can't send a score or a time", () => {
    expect(parseGameAction({ type: "start", startedAt: 0 })).toEqual({ type: "start" });
    expect(parseGameAction({ type: "next", points: 1e9 })).toEqual({ type: "next" });
    expect(parseGameAction({ type: "guess", guess: "x", seconds: 0 })).toEqual({ type: "guess", guess: "x" });
  });

  it("no longer accepts reveal or skip (#255)", () => {
    expect(() => parseGameAction({ type: "reveal" })).toThrow(InvalidGameActionError);
    expect(() => parseGameAction({ type: "skip" })).toThrow(InvalidGameActionError);
  });

  it("rejects overly long guesses", () => {
    expect(() => parseGameAction({ type: "guess", guess: "x".repeat(MAX_GUESS_LENGTH + 1) })).toThrow(/at most/);
    expect(parseGameAction({ type: "guess", guess: "x".repeat(MAX_GUESS_LENGTH) }).type).toBe("guess");
  });
});

describe("act with the revision the player saw (#107)", () => {
  it("applies the action when the revision matches, and the view carries the new one", async () => {
    const { deps, pack } = setup();
    const ready = await startGame(deps, pack, ALICE, CONFIG);
    const started = await act(deps, ready.gameId, ALICE, { type: "start" }, 0);
    expect(started.revision).toBe(1);
  });

  it("throws GameConflictError for a stale revision and changes nothing (a second tab can't restart the clock)", async () => {
    const { deps, store, pack } = setup();
    const ready = await startGame(deps, pack, ALICE, CONFIG);
    await play(deps, ready, { type: "start" });
    const before = store.raw(ready.gameId);
    await expect(play(deps, ready, { type: "start" })).rejects.toBeInstanceOf(GameConflictError);
    expect(store.raw(ready.gameId)).toBe(before);
  });

  it("counts a time-out saved by a load as a new revision, so an action from before it conflicts", async () => {
    const { deps, clock, view } = await startedGame();
    clock.at(31);
    await getGame(deps, view.gameId, ALICE);
    await expect(play(deps, view, { type: "guess", guess: WRONG })).rejects.toBeInstanceOf(GameConflictError);
  });

  it("throws InvalidGameActionError for a malformed revision and changes nothing", async () => {
    const { deps, store, view } = await startedGame();
    const before = store.raw(view.gameId);
    for (const bad of [-1, 1.5, Number.NaN, "1"]) {
      await expect(act(deps, view.gameId, ALICE, { type: "next" }, bad as number)).rejects.toBeInstanceOf(
        InvalidGameActionError,
      );
    }
    expect(store.raw(view.gameId)).toBe(before);
  });

  it("checks the owner before the revision, so a stranger still gets GameNotFoundError", async () => {
    const { deps, view } = await startedGame();
    await expect(act(deps, view.gameId, BOB, { type: "next" }, -1)).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(act(deps, view.gameId, BOB, { type: "next" }, 99)).rejects.toBeInstanceOf(GameNotFoundError);
  });
});

describe("stored record", () => {
  it("is plain JSON with the round state, the server's start time, events and config, and no answers", async () => {
    const { deps, pack, store, puzzles, clock } = setup();
    const owner = { anonId: "anon-1" };
    const { gameId } = await startGame(deps, pack, owner, CONFIG);
    await act(deps, gameId, owner, { type: "start" }, 0);
    clock.at(4);
    await act(deps, gameId, owner, { type: "guess", guess: WRONG }, 1);

    const raw = store.raw(gameId)!;
    expect(JSON.parse(raw) as StoredGame).toEqual({
      id: gameId,
      owner,
      packId: "practice",
      revision: 2,
      state: {
        schemaVersion: 2,
        pack: { id: "practice", kind: "practice", title: "Practice", theme: "Mixed" },
        puzzleIds: ["p1", "p2", "p3"],
        scoring: CONFIG,
        index: 0,
        round: { puzzleId: "p1", state: "playing", startedAt: T0, wrongGuesses: 1 },
        finished: false,
        events: [{ type: "wrongGuess", puzzleId: "p1" }],
        lastOutcome: { kind: "incorrect", normalizedGuess: WRONG },
      },
    });
    // Puzzles are referenced by id, so the games table never holds answers.
    for (const secret of secrets(puzzles)) expect(raw.toLowerCase()).not.toContain(secret);
  });
});

describe("games stored under the old rules (schemaVersion 1)", () => {
  async function oldGame() {
    const s = setup();
    const view = await startGame(s.deps, s.pack, ALICE, CONFIG);
    const stored = (await s.store.get(view.gameId))!;
    const old = { ...stored, state: { ...stored.state, schemaVersion: 1 } } as unknown as StoredGame;
    await s.store.save(old);
    return { ...s, gameId: view.gameId };
  }

  it("can't be loaded or played: GameFromOldRulesError, a GameUnreadableError", async () => {
    const { deps, gameId } = await oldGame();
    await expect(getGame(deps, gameId, ALICE)).rejects.toBeInstanceOf(GameFromOldRulesError);
    await expect(getGame(deps, gameId, ALICE)).rejects.toBeInstanceOf(GameUnreadableError);
    await expect(act(deps, gameId, ALICE, { type: "start" }, 1)).rejects.toBeInstanceOf(GameFromOldRulesError);
  });

  it("still looks missing to anyone else", async () => {
    const { deps, gameId } = await oldGame();
    await expect(getGame(deps, gameId, BOB)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it("a daily from before: resumeDaily throws it too, so the daily says the game is lost", async () => {
    const s = setup();
    const daily: Pack = { ...s.pack, kind: "daily" };
    const view = await startGame(s.deps, daily, ALICE, CONFIG, { dailyDate: "2030-01-01" });
    const stored = (await s.store.get(view.gameId))!;
    await s.store.save({ ...stored, state: { ...stored.state, schemaVersion: 1 } } as unknown as StoredGame);
    await expect(resumeDaily(s.deps, ALICE, "2030-01-01")).rejects.toBeInstanceOf(GameFromOldRulesError);
  });
});

describeGameStoreContract("MemoryGameStore", async () => ({
  store: new MemoryGameStore(),
  alice: ALICE,
  bob: BOB,
  packId: "practice",
  missingId: "no-such-game",
}));

describe("answers once the game is finished (#58)", () => {
  it("names every image in the finished view, and in no view before that", async () => {
    const { deps, pack, puzzles } = setup();
    let view = await startGame(deps, pack, ALICE, CONFIG);
    for (const puzzle of puzzles) {
      expect(view).not.toHaveProperty("answers");
      view = await play(deps, view, { type: "start" });
      view = await play(deps, view, { type: "guess", guess: puzzle.answer });
      expect(view).not.toHaveProperty("answers"); // this round is over, but the game isn't
      view = await play(deps, view, { type: "next" });
    }
    expect(view.finished).toBe(true);
    expect(view.answers).toEqual(puzzles.map((p) => p.answer));
    expect((await getGame(deps, view.gameId, ALICE)).answers).toEqual(puzzles.map((p) => p.answer));
  });
});
