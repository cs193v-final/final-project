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
    for (const action of ACTIONS) view = await act(deps, view.gameId, ALICE, action);

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
    view = await act(deps, view.gameId, ALICE, { type: "guess", guess: OPAQUE_SAMPLES[0]!.answer });
    expect(view.total).toBe(1000);
  });

  it("updates pointsAvailable and the running total as the game goes", async () => {
    const { deps, pack } = setup();
    let view = await startGame(deps, pack, ALICE, CONFIG);
    view = await act(deps, view.gameId, ALICE, { type: "reveal" });
    expect(view.round?.pointsAvailable).toBe(80);
    view = await act(deps, view.gameId, ALICE, { type: "guess", guess: WRONG });
    expect(view.round).toMatchObject({ wrongGuesses: 1, pointsAvailable: 70 });
    expect(view.lastOutcome).toEqual({ kind: "incorrect", normalizedGuess: WRONG });
    expect(view.total).toBe(0);
    view = await act(deps, view.gameId, ALICE, { type: "guess", guess: OPAQUE_SAMPLES[0]!.answer });
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
        views.push(await act(deps, gameId, ALICE, action));
        views.push(await getGame(deps, gameId, ALICE));
      }
    }
    // After the game: every action type is rejected and the views stay safe.
    for (const action of [{ type: "reveal" }, { type: "guess", guess: WRONG }, { type: "skip" }, { type: "next" }] as const) {
      views.push(await act(deps, gameId, ALICE, action));
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
        view = await act(deps, view.gameId, ALICE, action);
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
      for (const action of scriptFor(puzzle, i)) views.push(await act(deps, gameId, ALICE, action));
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
    const next = await act(deps, view.gameId, ALICE, { type: "skip" }).then(() => act(deps, view.gameId, ALICE, { type: "next" }));
    expect(next.round?.aiSolvedLevel).toBeNull();
    expectNoAnswers(next, puzzles);
  });
});

describe("after a round ends", () => {
  it("shows the answer and credit once the round is answered", async () => {
    const { deps, pack, puzzles } = setup();
    const start = await startGame(deps, pack, ALICE, CONFIG);
    const view = await act(deps, start.gameId, ALICE, { type: "guess", guess: puzzles[0]!.answer });
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
    const view = await act(deps, start.gameId, ALICE, { type: "skip" });
    expect(view.round).toMatchObject({ state: "skipped", answer: puzzles[0]!.answer, credit: puzzles[0]!.credit });
  });

  it("never sends accepted answers, even when the player typed one", async () => {
    const { deps, pack, puzzles } = setup();
    const alternate = puzzles[0]!.acceptedAnswers[0]!; // "Giraffes"
    const start = await startGame(deps, pack, ALICE, CONFIG);
    const view = await act(deps, start.gameId, ALICE, { type: "guess", guess: alternate });
    expect(view.round?.state).toBe("correct");
    // The canonical answer is shown instead of the alternate that matched.
    expect(view.lastOutcome).toEqual({ kind: "correct", matched: puzzles[0]!.answer });
    expect(JSON.stringify(view)).not.toContain(alternate);
    expect(JSON.stringify(view)).not.toMatch(/acceptedAnswers/);
  });

  it("hides the answer again when the next round starts", async () => {
    const { deps, pack, puzzles } = setup();
    const start = await startGame(deps, pack, ALICE, CONFIG);
    await act(deps, start.gameId, ALICE, { type: "skip" });
    const view = await act(deps, start.gameId, ALICE, { type: "next" });
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
    await expect(act(deps, gameId, BOB, { type: "skip" })).rejects.toBeInstanceOf(GameNotFoundError);
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
    await act(deps, start.gameId, ALICE, { type: "skip" });
    await act(deps, start.gameId, ALICE, { type: "next" });
    await act(deps, start.gameId, ALICE, { type: "reveal" });
    const last = await act(deps, start.gameId, ALICE, { type: "guess", guess: WRONG });

    // A new request: fresh deps objects, same underlying store.
    const later: GameDeps = { games: store, puzzles: puzzleSourceFrom(puzzles) };
    const resumed = await getGame(later, start.gameId, ALICE);
    expect(resumed).toEqual(last);
    expect(resumed.round).toMatchObject({ position: 2, revealLevel: 1, wrongGuesses: 1 });

    // And play carries on from there.
    const next = await act(later, start.gameId, ALICE, { type: "guess", guess: puzzles[1]!.answer });
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
    const ended = await act(deps, start.gameId, ALICE, { type: "skip" });
    const raw = store.raw(start.gameId);
    for (const action of [
      { type: "guess", guess: puzzles[0]!.answer },
      { type: "reveal" },
      { type: "skip" },
    ] as const) {
      expect(await act(deps, start.gameId, ALICE, action)).toEqual(ended);
    }
    expect(store.raw(start.gameId)).toBe(raw);
  });

  it("next while playing, reveal at the full image, and a blank guess", async () => {
    const { deps, store, view: start, puzzles } = await started();
    expect(await act(deps, start.gameId, ALICE, { type: "next" })).toEqual(start);
    expect(await act(deps, start.gameId, ALICE, { type: "guess", guess: "  " })).toEqual(start);

    let view = start;
    for (let i = 1; i < puzzles[0]!.reveal.zoomLevels.length; i++) {
      view = await act(deps, start.gameId, ALICE, { type: "reveal" });
    }
    const raw = store.raw(start.gameId);
    expect(await act(deps, start.gameId, ALICE, { type: "reveal" })).toEqual(view);
    expect(store.raw(start.gameId)).toBe(raw);
    expect(view.round?.wrongGuesses).toBe(0);
  });

  it("every action after the game is finished", async () => {
    const { deps, view: start, puzzles } = await started();
    let view = start;
    for (let i = 0; i < puzzles.length; i++) {
      await act(deps, start.gameId, ALICE, { type: "skip" });
      view = await act(deps, start.gameId, ALICE, { type: "next" });
    }
    expect(view).toMatchObject({ finished: true, round: null });
    for (const action of [{ type: "reveal" }, { type: "skip" }, { type: "next" }, { type: "guess", guess: "x" }] as const) {
      expect(await act(deps, start.gameId, ALICE, action)).toEqual(view);
    }
  });

  it("a malformed action from a client throws InvalidGameActionError", async () => {
    const { deps, view } = await started();
    const bad = [null, "skip", [], {}, { type: "score", points: 1000 }, { type: "guess" }, { type: "guess", guess: 42 }];
    for (const action of bad) {
      await expect(act(deps, view.gameId, ALICE, action as unknown as GameAction)).rejects.toBeInstanceOf(
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

describe("stored record", () => {
  it("is plain JSON with the round state, events and config, and no answers", async () => {
    const { deps, pack, store, puzzles } = setup();
    const { gameId } = await startGame(deps, pack, { anonId: "anon-1" }, CONFIG);
    await act(deps, gameId, { anonId: "anon-1" }, { type: "reveal" });
    await act(deps, gameId, { anonId: "anon-1" }, { type: "guess", guess: WRONG });

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
        round: { puzzleId: "p1", state: "playing", revealLevel: 1, maxRevealLevel: 3, wrongGuesses: 1 },
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
    await act(deps, gameId, ALICE, { type: "reveal" });
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

describe("pre-cut level images (#57)", () => {
  // Each puzzle with one URL per level, as the database puzzle source gives them.
  const CUT: Puzzle[] = OPAQUE_SAMPLES.map((p) => ({
    ...p,
    levelImages: p.reveal.zoomLevels.map((_z, level) => `/img/${p.id}-level-${level}.webp`),
  }));
  const levelUrls = (p: Puzzle) => p.levelImages!;

  /** Every pre-cut URL in the view (as sent), so we can check none beyond the level reached leaks. */
  const urlsIn = (view: GameView) => JSON.stringify(view).match(/\/img\/p\d-level-\d\.webp/gu) ?? [];

  it("sends only the image for the level reached, and no crop settings", async () => {
    const { deps, pack } = setup(CUT);
    let view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view.round!.imageSrc).toBe(levelUrls(CUT[0]!)[0]);
    expect(view.round).not.toHaveProperty("reveal");
    expect(urlsIn(view)).toEqual([levelUrls(CUT[0]!)[0]]);

    view = await act(deps, view.gameId, ALICE, { type: "reveal" });
    expect(view.round!.imageSrc).toBe(levelUrls(CUT[0]!)[1]);
    expect(urlsIn(view)).toEqual([levelUrls(CUT[0]!)[1]]);
    expectNoAnswers(view, CUT);
  });

  it("shows the full image (the last level) once the round is over", async () => {
    const { deps, pack } = setup(CUT);
    const view = await act(deps, (await startGame(deps, pack, ALICE, CONFIG)).gameId, ALICE, { type: "skip" });
    const levels = levelUrls(CUT[0]!);
    expect(view.round!.imageSrc).toBe(levels[levels.length - 1]);
  });

  it("never sends a later level's URL at any point of a whole game", async () => {
    const { deps, pack } = setup(CUT);
    let view = await startGame(deps, pack, ALICE, CONFIG);
    for (const p of CUT) {
      for (let level = 0; level < p.reveal.zoomLevels.length - 1; level++) {
        const sent = urlsIn(view);
        const allowed = levelUrls(p).slice(0, level + 1);
        for (const url of sent) expect(allowed, `${url} at level ${level}`).toContain(url);
        view = await act(deps, view.gameId, ALICE, { type: "reveal" });
      }
      view = await act(deps, view.gameId, ALICE, { type: "skip" });
      view = await act(deps, view.gameId, ALICE, { type: "next" });
    }
    expect(view.finished).toBe(true);
  });

  it("keeps the old behaviour for puzzles without cuts (practice): the full image plus crop settings", async () => {
    const { deps, pack } = setup();
    const view = await startGame(deps, pack, ALICE, CONFIG);
    expect(view.round!.imageSrc).toBe(OPAQUE_SAMPLES[0]!.imageUrl);
    expect(view.round!.reveal).toEqual(OPAQUE_SAMPLES[0]!.reveal);
  });
});
