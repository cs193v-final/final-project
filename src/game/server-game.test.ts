import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import { describeGameStoreContract } from "./game-store-contract.ts";
import { createGame, step } from "./round.ts";
import { scoreGame } from "./scoring.ts";
import {
  act,
  GameConflictError,
  GameNotFoundError,
  getGame,
  InvalidGameActionError,
  MAX_GUESS_LENGTH,
  MemoryGameStore,
  parseGameAction,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameOwner,
  type StoredGame,
} from "./server-game.ts";
import type { GameAction, GameView, Pack, Puzzle, ScoringConfig, ScoringEvent } from "./types.ts";

/** Plays a move on the game as it is now (reads its current revision first), for tests about other things than stale tabs. */
async function playNow(deps: GameDeps, gameId: string, owner: GameOwner, action: GameAction) {
  const { revision } = await getGame(deps, gameId, owner);
  return act(deps, gameId, owner, action, revision);
}


// Fixed numbers so these tests don't change when playtesting tweaks SCORING_CONFIG.
const CONFIG: ScoringConfig = {
  basePoints: 100,
  revealPenalty: 20,
  wrongGuessPenalty: 10,
  minPoints: 10,
  skipPoints: 0,
};

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
  return {
    id: "practice",
    kind: "practice",
    title: "Practice",
    theme: "Mixed",
    puzzleIds: puzzles.map((p) => p.id),
  };
}

function setup(puzzles: readonly Puzzle[] = OPAQUE_SAMPLES) {
  let n = 0;
  const store = new MemoryGameStore(() => `game-${++n}`);
  const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(puzzles) };
  return { store, deps, pack: packOf(puzzles), puzzles };
}

/** Lowercased answer strings that must not appear in a view while a round is playing. */
function secrets(puzzles: readonly Puzzle[]): string[] {
  return puzzles.flatMap((p) => [p.answer, ...p.acceptedAnswers]).map((s) => s.toLowerCase());
}

/**
 * The anti-cheat check (#54): while the round is playing, the whole response,
 * serialized exactly as it would be sent, contains no answer or accepted
 * answer of ANY puzzle in the game (current, earlier or later).
 */
function expectNoAnswers(view: GameView, puzzles: readonly Puzzle[]): void {
  const json = JSON.stringify(view);
  expect(json).not.toMatch(/acceptedAnswers/);
  if (view.round?.state !== "playing") return;
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
  it("returns the first round with no answer, a fresh score and only public pack fields", async () => {
    const { deps, pack, puzzles } = setup();
    const view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view).toEqual({
      gameId: "game-1",
      revision: 0,
      pack: { id: "practice", kind: "practice", title: "Practice", theme: "Mixed" },
      round: {
        position: 1,
        puzzleCount: 3,
        state: "playing",
        revealLevel: 0,
        levelCount: puzzles[0]!.reveal.zoomLevels.length,
        imageSrc: puzzles[0]!.imageUrl,
        reveal: puzzles[0]!.reveal,
        wrongGuesses: 0,
        pointsAvailable: 100,
        aiSolvedLevel: puzzles[0]!.aiSolvedLevel,
      },
      results: [],
      total: 0,
      finished: false,
    });
  });

  it("rejects bad input before storing anything", async () => {
    const { deps, pack, store } = setup();
    await expect(startGame(deps, { ...pack, puzzleIds: ["p1", "nope"] }, ALICE, CONFIG)).rejects.toThrow(
      /no puzzle "nope"/,
    );
    await expect(startGame(deps, { ...pack, puzzleIds: [] }, ALICE, CONFIG)).rejects.toThrow(/at least one/);
    await expect(startGame(deps, pack, ALICE, { ...CONFIG, minPoints: 500 })).rejects.toThrow(/minPoints/);
    await expect(startGame(deps, pack, { userId: "" }, CONFIG)).rejects.toThrow(/non-empty/);
    expect(store.raw("game-1")).toBeUndefined();
  });
});

describe("a full game played through", () => {
  const ACTIONS: GameAction[] = [
    // Round 1: correct straight away.
    { type: "guess", guess: OPAQUE_SAMPLES[0]!.answer },
    { type: "next" },
    // Round 2: zoom out, miss, zoom out, correct with an accepted alternate.
    { type: "reveal" },
    { type: "guess", guess: WRONG },
    { type: "reveal" },
    { type: "guess", guess: OPAQUE_SAMPLES[1]!.acceptedAnswers[0]! },
    { type: "next" },
    // Round 3: zoom out, then skip.
    { type: "reveal" },
    { type: "skip" },
    { type: "next" },
  ];

  it("ends finished, with every round scored on the server exactly as scoreGame scores the same events", async () => {
    const { deps, pack, puzzles } = setup();
    let view = await startGame(deps, pack, ALICE, CONFIG);
    for (const action of ACTIONS) view = await act(deps, view.gameId, ALICE, action, view.revision);

    // The same actions through round.ts directly give the expected events.
    let game = createGame(puzzles);
    const events: ScoringEvent[] = [];
    for (const action of ACTIONS) {
      const result = step(game, action);
      expect(result.ok).toBe(true);
      game = result.game;
      events.push(...result.events);
    }
    const expected = scoreGame(events, CONFIG);

    expect(view.finished).toBe(true);
    expect(view.round).toBeNull();
    expect(view.results).toEqual(expected.rounds);
    expect(view.total).toBe(expected.total);
    expect(view.results.map((r) => [r.outcome, r.points])).toEqual([
      ["correct", 100],
      ["correct", 50],
      ["skipped", 0],
    ]);
    expect(view.total).toBe(150);
  });

  it("uses the scoring config the game started with", async () => {
    const { deps, pack } = setup();
    const generous = { ...CONFIG, basePoints: 1000 };
    let view = await startGame(deps, pack, ALICE, generous);
    expect(view.round?.pointsAvailable).toBe(1000);
    view = await act(deps, view.gameId, ALICE, { type: "guess", guess: OPAQUE_SAMPLES[0]!.answer }, view.revision);
    expect(view.total).toBe(1000);
  });

  it("updates pointsAvailable and the running total as the game goes", async () => {
    const { deps, pack } = setup();
    let view = await startGame(deps, pack, ALICE, CONFIG);
    view = await act(deps, view.gameId, ALICE, { type: "reveal" }, view.revision);
    expect(view.round?.pointsAvailable).toBe(80);
    view = await act(deps, view.gameId, ALICE, { type: "guess", guess: WRONG }, view.revision);
    expect(view.round).toMatchObject({ wrongGuesses: 1, pointsAvailable: 70 });
    expect(view.lastOutcome).toEqual({ kind: "incorrect", normalizedGuess: WRONG });
    expect(view.total).toBe(0);
    view = await act(deps, view.gameId, ALICE, { type: "guess", guess: OPAQUE_SAMPLES[0]!.answer }, view.revision);
    expect(view.total).toBe(70);
    expect(view.results).toHaveLength(1);
  });
});

describe("no answers reach the browser while a round is playing", () => {
  /**
   * Every action type on every puzzle, including rejected ones: next while
   * playing, blank guess, wrong guess, every zoom-out up to and past the full
   * image, then a correct guess (alternating with skip), actions after the
   * round ended, and next.
   */
  function scriptFor(puzzle: Puzzle, index: number): GameAction[] {
    const reveals = puzzle.reveal.zoomLevels.length; // one more than allowed
    const ending: GameAction =
      index % 2 === 0 ? { type: "guess", guess: puzzle.acceptedAnswers[0] ?? puzzle.answer } : { type: "skip" };
    return [
      { type: "next" },
      { type: "guess", guess: "" },
      { type: "guess", guess: "   " },
      { type: "guess", guess: WRONG },
      ...Array.from({ length: reveals }, (): GameAction => ({ type: "reveal" })),
      { type: "guess", guess: "another wrong one" },
      ending,
      { type: "reveal" },
      { type: "guess", guess: puzzle.answer },
      { type: "skip" },
      { type: "next" },
    ];
  }

  it("serializes every view from startGame, act and getGame and finds no answer or accepted answer", async () => {
    const { deps, pack, puzzles } = setup();
    const views: GameView[] = [await startGame(deps, pack, ALICE, CONFIG)];
    const gameId = views[0]!.gameId;
    const seenTypes = new Set<string>();

    for (const [i, puzzle] of puzzles.entries()) {
      for (const action of scriptFor(puzzle, i)) {
        seenTypes.add(action.type);
        views.push(await playNow(deps, gameId, ALICE, action));
        views.push(await getGame(deps, gameId, ALICE));
      }
    }
    // After the game: every action type is rejected and the views stay safe.
    for (const action of [{ type: "reveal" }, { type: "guess", guess: WRONG }, { type: "skip" }, { type: "next" }] as const) {
      views.push(await playNow(deps, gameId, ALICE, action));
    }

    expect(seenTypes).toEqual(new Set(["reveal", "guess", "skip", "next"]));
    expect(views.filter((v) => v.round?.state === "playing").length).toBeGreaterThan(20);
    expect(views.at(-1)?.finished).toBe(true);
    for (const view of views) expectNoAnswers(view, puzzles);
  });

  it("holds for a long random sequence of actions over many games", async () => {
    const { deps, pack, puzzles } = setup();
    // Small seeded generator, so a failure is reproducible.
    let seed = 54;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    // Only the current puzzle's answers: a wrong guess that happens to be
    // another puzzle's answer is echoed back as the player's own input.
    const guessesFor = (view: GameView) => {
      const p = puzzles[(view.round?.position ?? 1) - 1]!;
      return ["", WRONG, p.answer, ...p.acceptedAnswers];
    };

    for (let g = 0; g < 10; g++) {
      let view = await startGame(deps, pack, ALICE, CONFIG);
      expectNoAnswers(view, puzzles);
      for (let n = 0; n < 60 && !view.finished; n++) {
        const r = random();
        const guesses = guessesFor(view);
        const action: GameAction =
          r < 0.35
            ? { type: "reveal" }
            : r < 0.75
              ? { type: "guess", guess: guesses[Math.floor(random() * guesses.length)]! }
              : r < 0.85
                ? { type: "skip" }
                : { type: "next" };
        view = await act(deps, view.gameId, ALICE, action, view.revision);
        expectNoAnswers(view, puzzles);
      }
    }
  });

  // Since #52 the practice pack's ids and image names are opaque, so the real
  // data passes too (this was an expected failure before). The full image is
  // still sent until per-level images (#57), but its name gives nothing away.
  it("also holds for the practice puzzles as stored in the repo, through a whole game", async () => {
    const { deps, pack, puzzles } = setup(SAMPLE_PUZZLES);
    const views: GameView[] = [await startGame(deps, pack, ALICE, CONFIG)];
    const gameId = views[0]!.gameId;
    for (const [i, puzzle] of puzzles.entries()) {
      for (const action of scriptFor(puzzle, i)) views.push(await playNow(deps, gameId, ALICE, action));
    }
    expect(views.at(-1)?.finished).toBe(true);
    for (const view of views) expectNoAnswers(view, puzzles);
  });
});

describe("aiSolvedLevel (#56)", () => {
  it("passes on the level the AI solved the puzzle at, and nothing else about the AI", async () => {
    const withAi = OPAQUE_SAMPLES.map((p, i) => ({ ...p, aiSolvedLevel: i === 0 ? 2 : null }));
    const { deps, pack, puzzles } = setup(withAi);
    const view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view.round?.aiSolvedLevel).toBe(2);
    const next = await playNow(deps, view.gameId, ALICE, { type: "skip" }).then(() => playNow(deps, view.gameId, ALICE, { type: "next" }));
    expect(next.round?.aiSolvedLevel).toBeNull();
    expectNoAnswers(next, puzzles);
  });
});

describe("beating the AI (#66)", () => {
  // The AI got p1 at level 1 and p2 at level 0; it has no result for p3.
  const withAi = OPAQUE_SAMPLES.map((p, i) => ({ ...p, aiSolvedLevel: [1, 0, null][i] ?? null }));

  it("counts it on the server once the game is finished, and only then", async () => {
    const { deps, pack, puzzles } = setup(withAi);
    let view = await startGame(deps, pack, ALICE, CONFIG);
    // p1: right at level 0, before the AI. p2: right at level 0, a tie. p3: right, but the AI has no result.
    for (const p of puzzles) {
      expect(view).not.toHaveProperty("beatAi");
      view = await act(deps, view.gameId, ALICE, { type: "guess", guess: p.answer }, view.revision);
      expect(view).not.toHaveProperty("beatAi"); // this round is over, but the game isn't
      view = await act(deps, view.gameId, ALICE, { type: "next" }, view.revision);
    }
    expect(view.finished).toBe(true);
    expect(view.beatAi).toEqual({ beaten: 1, played: 2 });
    expect((await getGame(deps, view.gameId, ALICE)).beatAi).toEqual({ beaten: 1, played: 2 });
  });

  it("counts nothing when the AI has no result for any image", async () => {
    const { deps, pack, puzzles } = setup(OPAQUE_SAMPLES.map((p) => ({ ...p, aiSolvedLevel: null })));
    let view = await startGame(deps, pack, ALICE, CONFIG);
    for (let i = 0; i < puzzles.length; i++) {
      view = await act(deps, view.gameId, ALICE, { type: "skip" }, view.revision);
      view = await act(deps, view.gameId, ALICE, { type: "next" }, view.revision);
    }
    expect(view.beatAi).toEqual({ beaten: 0, played: 0 });
  });
});

describe("per-level images (#57)", () => {
  /** Fake cut levels: one opaque URL per zoom level for each puzzle. */
  function levelSrcs(puzzles: readonly Puzzle[]): Map<string, string[]> {
    return new Map(
      puzzles.map((p, i) => [p.id, p.reveal.zoomLevels.map((_, level) => `/img/${String(i).padStart(2, "0")}${String(level).padStart(30, "f")}.webp`)]),
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

  /** Every URL in a serialized view that isn't `allowed`: none may be another level, or a puzzle's original image. */
  function expectOnlyImage(view: GameView, allowed: string, srcs: Map<string, string[]>, puzzles: readonly Puzzle[]): void {
    const json = JSON.stringify(view);
    expect(view.round?.imageSrc).toBe(allowed);
    expect(view.round).not.toHaveProperty("reveal");
    for (const src of [...srcs.values()].flat()) if (src !== allowed) expect(json).not.toContain(src);
    for (const p of puzzles) expect(json).not.toContain(p.imageUrl);
  }

  it("sends only the URL of the level reached while playing, and no crop settings", async () => {
    const { deps, pack, puzzles, srcs } = withLevels();
    const view = await startGame(deps, pack, ALICE, CONFIG);
    expectOnlyImage(view, srcs.get("p1")![0]!, srcs, puzzles);
    expectNoAnswers(view, puzzles);
  });

  it("sends the next level's URL only after a zoom out, never one further", async () => {
    const { deps, pack, puzzles, srcs } = withLevels();
    const { gameId } = await startGame(deps, pack, ALICE, CONFIG);
    const levels = srcs.get("p1")!;
    for (let level = 1; level < levels.length; level++) {
      const view = await playNow(deps, gameId, ALICE, { type: "reveal" });
      expectOnlyImage(view, levels[level]!, srcs, puzzles);
    }
    // A refresh (getGame) gives the same level, not a later one.
    expectOnlyImage(await getGame(deps, gameId, ALICE), levels.at(-1)!, srcs, puzzles);
  });

  it("sends the full image's level once the round is over, then the next puzzle's tightest level", async () => {
    const { deps, pack, puzzles, srcs } = withLevels();
    const { gameId } = await startGame(deps, pack, ALICE, CONFIG);
    const answered = await playNow(deps, gameId, ALICE, { type: "guess", guess: puzzles[0]!.answer });
    expect(answered.round?.state).toBe("correct");
    expectOnlyImage(answered, srcs.get("p1")!.at(-1)!, srcs, puzzles);
    const next = await playNow(deps, gameId, ALICE, { type: "next" });
    expectOnlyImage(next, srcs.get("p2")![0]!, srcs, puzzles);
  });

  it("looks up only the current puzzle's levels, and none once the game is finished", async () => {
    const { deps, pack, lookups } = withLevels();
    // Explicit revisions rather than playNow, whose getGame would add lookups.
    let view = await startGame(deps, pack, ALICE, CONFIG);
    const { gameId } = view;
    view = await act(deps, gameId, ALICE, { type: "skip" }, view.revision);
    view = await act(deps, gameId, ALICE, { type: "next" }, view.revision);
    expect(lookups).toEqual([["p1"], ["p1"], ["p2"]]);
    for (let i = 1; i < OPAQUE_SAMPLES.length; i++) {
      view = await act(deps, gameId, ALICE, { type: "skip" }, view.revision);
      view = await act(deps, gameId, ALICE, { type: "next" }, view.revision);
    }
    const before = lookups.length;
    const finished = await getGame(deps, gameId, ALICE);
    expect(finished.finished).toBe(true);
    expect(lookups).toHaveLength(before);
  });

  it("still sends a public practice image whole, with its crop settings, until it's cut", async () => {
    const practice = OPAQUE_SAMPLES.map((p) => ({ ...p, imageUrl: `/puzzles/${p.id}.jpg` }));
    const { deps, pack } = withLevels(practice, new Map());
    const view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view.round?.imageSrc).toBe("/puzzles/p1.jpg");
    expect(view.round?.reveal).toEqual(practice[0]!.reveal);
  });

  it("never sends a private image that hasn't been cut: the call fails instead", async () => {
    const daily = OPAQUE_SAMPLES.map((p) => ({ ...p, imageUrl: `images/${p.id}.jpg` }));
    const { deps, pack } = withLevels(daily, new Map());
    await expect(startGame(deps, pack, ALICE, CONFIG)).rejects.toThrow(/p1 has no cut level images/);
  });

  it("treats a puzzle with fewer levels than zoom levels as not cut", async () => {
    // A gap in the levels never gets here: getLevelSrcs leaves such a puzzle out (src/db/images.test.ts).
    const daily = OPAQUE_SAMPLES.map((p) => ({ ...p, imageUrl: `images/${p.id}.jpg` }));
    const srcs = levelSrcs(daily);
    srcs.set("p1", srcs.get("p1")!.slice(0, 1));
    const { deps, pack } = withLevels(daily, srcs);
    await expect(startGame(deps, pack, ALICE, CONFIG)).rejects.toThrow(/p1 has no cut level images/);
  });

  it("stores no game when its first puzzle can't be shown", async () => {
    const daily = OPAQUE_SAMPLES.map((p) => ({ ...p, imageUrl: `images/${p.id}.jpg` }));
    const { deps, pack, store } = withLevels(daily, new Map());
    await expect(startGame(deps, pack, ALICE, CONFIG)).rejects.toThrow(/p1 has no cut level images/);
    // The store hands out game-1, game-2, ...: the failed start used none.
    expect(store.raw("game-1")).toBeUndefined();
  });

  it("doesn't move a game on to a puzzle it can't show, so the game stays playable", async () => {
    const daily = OPAQUE_SAMPLES.map((p) => ({ ...p, imageUrl: `images/${p.id}.jpg` }));
    const srcs = levelSrcs(daily);
    srcs.delete("p2"); // p1 is cut, p2 isn't
    const { deps, pack, store } = withLevels(daily, srcs);
    const { gameId } = await startGame(deps, pack, ALICE, CONFIG);
    await playNow(deps, gameId, ALICE, { type: "skip" });
    const before = store.raw(gameId);

    await expect(playNow(deps, gameId, ALICE, { type: "next" })).rejects.toThrow(/p2 has no cut level images/);
    expect(store.raw(gameId)).toBe(before);
    // Still on p1's finished round, so a reload works instead of failing every time.
    const view = await getGame(deps, gameId, ALICE);
    expect(view.round?.position).toBe(1);
    expect(view.round?.state).toBe("skipped");
  });
});

describe("after a round ends", () => {
  it("shows the answer and credit once the round is answered", async () => {
    const { deps, pack, puzzles } = setup();
    const start = await startGame(deps, pack, ALICE, CONFIG);
    const view = await playNow(deps, start.gameId, ALICE, { type: "guess", guess: puzzles[0]!.answer });
    expect(view.round).toMatchObject({
      state: "correct",
      answer: puzzles[0]!.answer,
      credit: puzzles[0]!.credit,
    });
    expect(view.lastOutcome).toEqual({ kind: "correct", matched: puzzles[0]!.answer });
  });

  it("shows the answer and credit once the round is skipped", async () => {
    const { deps, pack, puzzles } = setup();
    const start = await startGame(deps, pack, ALICE, CONFIG);
    const view = await playNow(deps, start.gameId, ALICE, { type: "skip" });
    expect(view.round).toMatchObject({ state: "skipped", answer: puzzles[0]!.answer, credit: puzzles[0]!.credit });
  });

  it("never sends accepted answers, even when the player typed one", async () => {
    const { deps, pack, puzzles } = setup();
    const alternate = puzzles[0]!.acceptedAnswers[0]!; // "Giraffes"
    const start = await startGame(deps, pack, ALICE, CONFIG);
    const view = await playNow(deps, start.gameId, ALICE, { type: "guess", guess: alternate });
    expect(view.round?.state).toBe("correct");
    // The canonical answer is shown instead of the alternate that matched.
    expect(view.lastOutcome).toEqual({ kind: "correct", matched: puzzles[0]!.answer });
    expect(JSON.stringify(view)).not.toContain(alternate);
    expect(JSON.stringify(view)).not.toMatch(/acceptedAnswers/);
  });

  it("hides the answer again when the next round starts", async () => {
    const { deps, pack, puzzles } = setup();
    const start = await startGame(deps, pack, ALICE, CONFIG);
    await playNow(deps, start.gameId, ALICE, { type: "skip" });
    const view = await playNow(deps, start.gameId, ALICE, { type: "next" });
    expect(view.round).toMatchObject({ position: 2, state: "playing" });
    expect(view.lastOutcome).toBeUndefined();
    expectNoAnswers(view, puzzles);
  });
});

describe("ownership", () => {
  it("another owner gets GameNotFoundError from act and getGame, and the game is unchanged", async () => {
    const { deps, pack, store } = setup();
    const { gameId } = await startGame(deps, pack, ALICE, CONFIG);
    const before = store.raw(gameId);

    await expect(getGame(deps, gameId, BOB)).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(act(deps, gameId, BOB, { type: "skip" }, 0)).rejects.toBeInstanceOf(GameNotFoundError);
    expect(store.raw(gameId)).toBe(before);
  });

  it("doesn't reveal whether the game exists", async () => {
    const { deps, pack } = setup();
    const { gameId } = await startGame(deps, pack, ALICE, CONFIG);
    const otherOwner = await getGame(deps, gameId, BOB).catch((e: unknown) => e);
    const noSuchGame = await getGame(deps, "no-such-game", ALICE).catch((e: unknown) => e);
    expect(otherOwner).toBeInstanceOf(GameNotFoundError);
    expect(noSuchGame).toBeInstanceOf(GameNotFoundError);
    expect((otherOwner as Error).message).toBe((noSuchGame as Error).message);
  });

  it("treats a user and an anonymous visitor with the same id as different owners", async () => {
    const { deps, pack } = setup();
    const { gameId } = await startGame(deps, pack, { anonId: "x" }, CONFIG);
    await expect(getGame(deps, gameId, { userId: "x" })).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(getGame(deps, gameId, { anonId: "x" })).resolves.toMatchObject({ gameId });
  });
});

describe("resuming after a refresh", () => {
  it("getGame on a later request returns the same view the last action did", async () => {
    const { deps, pack, store, puzzles } = setup();
    const start = await startGame(deps, pack, ALICE, CONFIG);
    await playNow(deps, start.gameId, ALICE, { type: "skip" });
    await playNow(deps, start.gameId, ALICE, { type: "next" });
    await playNow(deps, start.gameId, ALICE, { type: "reveal" });
    const last = await playNow(deps, start.gameId, ALICE, { type: "guess", guess: WRONG });

    // A new request: fresh deps objects, same underlying store.
    const later: GameDeps = { games: store, puzzles: puzzleSourceFrom(puzzles) };
    const resumed = await getGame(later, start.gameId, ALICE);
    expect(resumed).toEqual(last);
    expect(resumed.round).toMatchObject({ position: 2, revealLevel: 1, wrongGuesses: 1 });

    // And play carries on from there.
    const next = await act(later, start.gameId, ALICE, { type: "guess", guess: puzzles[1]!.answer }, resumed.revision);
    expect(next.results.map((r) => r.outcome)).toEqual(["skipped", "correct"]);
  });
});

describe("invalid actions are rejected like round.ts rejects them: nothing changes", () => {
  async function started() {
    const s = setup();
    const view = await startGame(s.deps, s.pack, ALICE, CONFIG);
    return { ...s, view };
  }

  it("guess, reveal and skip after the round ended", async () => {
    const { deps, store, view: start, puzzles } = await started();
    const ended = await playNow(deps, start.gameId, ALICE, { type: "skip" });
    const raw = store.raw(start.gameId);
    for (const action of [
      { type: "guess", guess: puzzles[0]!.answer },
      { type: "reveal" },
      { type: "skip" },
    ] as const) {
      expect(await playNow(deps, start.gameId, ALICE, action)).toEqual(ended);
    }
    expect(store.raw(start.gameId)).toBe(raw);
  });

  it("next while playing, reveal at the full image, and a blank guess", async () => {
    const { deps, store, view: start, puzzles } = await started();
    expect(await playNow(deps, start.gameId, ALICE, { type: "next" })).toEqual(start);
    expect(await playNow(deps, start.gameId, ALICE, { type: "guess", guess: "  " })).toEqual(start);

    let view = start;
    for (let i = 1; i < puzzles[0]!.reveal.zoomLevels.length; i++) {
      view = await playNow(deps, start.gameId, ALICE, { type: "reveal" });
    }
    const raw = store.raw(start.gameId);
    expect(await playNow(deps, start.gameId, ALICE, { type: "reveal" })).toEqual(view);
    expect(store.raw(start.gameId)).toBe(raw);
    expect(view.round?.wrongGuesses).toBe(0);
  });

  it("every action after the game is finished", async () => {
    const { deps, view: start, puzzles } = await started();
    let view = start;
    for (let i = 0; i < puzzles.length; i++) {
      await playNow(deps, start.gameId, ALICE, { type: "skip" });
      view = await playNow(deps, start.gameId, ALICE, { type: "next" });
    }
    expect(view).toMatchObject({ finished: true, round: null });
    for (const action of [{ type: "reveal" }, { type: "skip" }, { type: "next" }, { type: "guess", guess: "x" }] as const) {
      expect(await playNow(deps, start.gameId, ALICE, action)).toEqual(view);
    }
  });

  it("a malformed action from a client throws InvalidGameActionError", async () => {
    const { deps, view } = await started();
    const bad = [null, "skip", [], {}, { type: "score", points: 1000 }, { type: "guess" }, { type: "guess", guess: 42 }];
    for (const action of bad) {
      await expect(playNow(deps, view.gameId, ALICE, action as unknown as GameAction)).rejects.toBeInstanceOf(
        InvalidGameActionError,
      );
    }
  });
});

describe("parseGameAction", () => {
  it("accepts every action type and drops extra fields, so a client can't send a score", () => {
    expect(parseGameAction({ type: "reveal", points: 1000 })).toEqual({ type: "reveal" });
    expect(parseGameAction({ type: "skip", total: 1000 })).toEqual({ type: "skip" });
    expect(parseGameAction({ type: "next" })).toEqual({ type: "next" });
    expect(parseGameAction({ type: "guess", guess: "Giraffe", puzzleId: "p2" })).toEqual({
      type: "guess",
      guess: "Giraffe",
    });
  });

  it("rejects overly long guesses", () => {
    expect(parseGameAction({ type: "guess", guess: "a".repeat(MAX_GUESS_LENGTH) }).type).toBe("guess");
    expect(() => parseGameAction({ type: "guess", guess: "a".repeat(MAX_GUESS_LENGTH + 1) })).toThrow(
      InvalidGameActionError,
    );
  });
});

describe("act with the revision the player saw (#107)", () => {
  it("applies the action when the revision matches, and the view carries the new one", async () => {
    const { deps, pack } = setup();
    const start = await startGame(deps, pack, ALICE, CONFIG);
    expect(start.revision).toBe(0);
    const view = await act(deps, start.gameId, ALICE, { type: "reveal" }, start.revision);
    expect(view.revision).toBe(1);
    expect(view.round?.revealLevel).toBe(1);
  });

  it("throws GameConflictError for a stale revision and changes nothing", async () => {
    const { deps, pack, store } = setup();
    const tabA = await startGame(deps, pack, ALICE, CONFIG);
    // Another tab skips round 1, so the game is on round 2.
    await act(deps, tabA.gameId, ALICE, { type: "skip" }, tabA.revision);
    const before = store.raw(tabA.gameId);
    await expect(act(deps, tabA.gameId, ALICE, { type: "skip" }, tabA.revision)).rejects.toBeInstanceOf(GameConflictError);
    expect(store.raw(tabA.gameId)).toBe(before);
  });

  it("throws InvalidGameActionError for a malformed revision and changes nothing", async () => {
    const { deps, pack, store } = setup();
    const view = await startGame(deps, pack, ALICE, CONFIG);
    const before = store.raw(view.gameId);
    for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, "0", null, undefined]) {
      await expect(act(deps, view.gameId, ALICE, { type: "skip" }, bad as number), String(bad)).rejects.toBeInstanceOf(
        InvalidGameActionError,
      );
    }
    expect(store.raw(view.gameId)).toBe(before);
  });

  it("checks the owner before the revision, so a stranger with a malformed one still gets GameNotFoundError", async () => {
    const { deps, pack } = setup();
    const view = await startGame(deps, pack, ALICE, CONFIG);
    for (const bad of [-1, "x", undefined]) {
      await expect(act(deps, view.gameId, BOB, { type: "skip" }, bad as number)).rejects.toBeInstanceOf(GameNotFoundError);
    }
  });

  it("checks the owner before the revision, so a stranger still gets GameNotFoundError", async () => {
    const { deps, pack } = setup();
    const view = await startGame(deps, pack, ALICE, CONFIG);
    await expect(act(deps, view.gameId, BOB, { type: "skip" }, 99)).rejects.toBeInstanceOf(GameNotFoundError);
  });
});

describe("stored record", () => {
  it("is plain JSON with the round state, events and config, and no answers", async () => {
    const { deps, pack, store, puzzles } = setup();
    const { gameId } = await startGame(deps, pack, { anonId: "anon-1" }, CONFIG);
    await act(deps, gameId, { anonId: "anon-1" }, { type: "reveal" }, 0);
    await act(deps, gameId, { anonId: "anon-1" }, { type: "guess", guess: WRONG }, 1);

    const raw = store.raw(gameId)!;
    const stored = JSON.parse(raw) as StoredGame;
    expect(stored).toEqual({
      id: gameId,
      owner: { anonId: "anon-1" },
      packId: "practice",
      revision: 2,
      state: {
        schemaVersion: 1,
        pack: { id: "practice", kind: "practice", title: "Practice", theme: "Mixed" },
        puzzleIds: ["p1", "p2", "p3"],
        scoring: CONFIG,
        index: 0,
        round: { puzzleId: "p1", state: "playing", revealLevel: 1, maxRevealLevel: puzzles[0]!.reveal.zoomLevels.length - 1, wrongGuesses: 1 },
        finished: false,
        events: [
          { type: "reveal", puzzleId: "p1", revealLevel: 1 },
          { type: "wrongGuess", puzzleId: "p1" },
        ],
        lastOutcome: { kind: "incorrect", normalizedGuess: WRONG },
      },
    });
    // Puzzles are referenced by id, so the games table never holds answers.
    for (const secret of secrets(puzzles)) expect(raw.toLowerCase()).not.toContain(secret);
  });

  it("a stale write throws GameConflictError instead of overwriting a newer one", async () => {
    const { deps, pack, store } = setup();
    const { gameId } = await startGame(deps, pack, ALICE, CONFIG);
    const stale = (await store.get(gameId))!;
    await act(deps, gameId, ALICE, { type: "reveal" }, 0);
    await expect(store.save(stale)).rejects.toBeInstanceOf(GameConflictError);
    expect((await store.get(gameId))!.state.round.revealLevel).toBe(1);
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
    for (let i = 0; i < puzzles.length; i++) {
      expect(view).not.toHaveProperty("answers");
      view = await act(deps, view.gameId, ALICE, { type: "skip" }, view.revision);
      expect(view).not.toHaveProperty("answers"); // this round is over, but the game isn't
      view = await act(deps, view.gameId, ALICE, { type: "next" }, view.revision);
    }
    expect(view.finished).toBe(true);
    expect(view.answers).toEqual(puzzles.map((p) => p.answer));
    // Loaded later (a reload), the same.
    expect((await getGame(deps, view.gameId, ALICE)).answers).toEqual(puzzles.map((p) => p.answer));
  });
});
