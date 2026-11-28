// The wrong-guess safety cap (#209, #85): a round stores at most
// MAX_WRONG_GUESSES_PER_ROUND wrong guesses, so a game's stored state can't
// grow without limit. It's not a gameplay limit (that's still open in #21):
// at the cap every further guess in the round is refused, a correct one too,
// and Zoom out and Skip still work. Scoring is unchanged.
import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import { MAX_SCORING_VALUE, pointsIfCorrect, scoreRound } from "./scoring.ts";
import {
  act,
  GameConflictError,
  GameNotFoundError,
  getGame,
  GuessLimitError,
  InvalidGameActionError,
  MAX_WRONG_GUESSES_PER_ROUND,
  MemoryGameStore,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameOwner,
  type GameState,
} from "./server-game.ts";
import type { GameAction, GameView, Pack, Puzzle, ScoringConfig } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks SCORING_CONFIG.
const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 5 };

const ALICE: GameOwner = { userId: "alice" };
const BOB: GameOwner = { userId: "bob" };

const PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));
const PACK: Pack = { id: "practice", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: PUZZLES.map((p) => p.id) };

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

async function wrongGuesses(deps: GameDeps, view: GameView, count: number): Promise<GameView> {
  for (let i = 0; i < count; i++) view = await play(deps, view, { type: "guess", guess: WRONG });
  return view;
}

/** A new game whose first round has exactly MAX_WRONG_GUESSES_PER_ROUND wrong guesses. */
async function atCap() {
  const s = setup();
  const start = await startGame(s.deps, PACK, ALICE, CONFIG);
  const view = await wrongGuesses(s.deps, start, MAX_WRONG_GUESSES_PER_ROUND);
  return { ...s, view };
}

function stateOf(store: MemoryGameStore, id: string): GameState {
  return (JSON.parse(store.raw(id)!) as { state: GameState }).state;
}

describe("MAX_WRONG_GUESSES_PER_ROUND (#209)", () => {
  it("is a safety cap far above what a player makes, not a gameplay limit (#21)", () => {
    expect(MAX_WRONG_GUESSES_PER_ROUND).toBe(50);
  });

  it("accepts the 50th wrong guess: counted, saved and scored as usual", async () => {
    const { view } = await atCap();
    expect(view.round).toMatchObject({ state: "playing", wrongGuesses: MAX_WRONG_GUESSES_PER_ROUND });
    expect(view.revision).toBe(MAX_WRONG_GUESSES_PER_ROUND);
    expect(view.lastOutcome).toMatchObject({ kind: "incorrect" });
    // Scoring is unchanged: points already stopped dropping at minPoints.
    expect(view.round!.pointsAvailable).toBe(pointsIfCorrect(0, MAX_WRONG_GUESSES_PER_ROUND, CONFIG));
    expect(view.round!.pointsAvailable).toBe(CONFIG.minPoints);
  });

  it("refuses the 51st with GuessLimitError (an InvalidGameActionError) and changes nothing", async () => {
    const { deps, store, view } = await atCap();
    const before = store.raw(view.gameId);
    await expect(play(deps, view, { type: "guess", guess: WRONG })).rejects.toThrow(GuessLimitError);
    await expect(play(deps, view, { type: "guess", guess: "another wrong one" })).rejects.toThrow(
      InvalidGameActionError,
    );
    expect(store.raw(view.gameId)).toBe(before);
    expect(await getGame(deps, view.gameId, ALICE)).toEqual(view);
  });

  it("refuses a correct answer at the cap too, so the round stays in play (zoom out or skip instead)", async () => {
    const { deps, store, view } = await atCap();
    const before = store.raw(view.gameId);
    await expect(play(deps, view, { type: "guess", guess: PUZZLES[0]!.answer })).rejects.toThrow(GuessLimitError);
    expect(store.raw(view.gameId)).toBe(before);
    const now = await getGame(deps, view.gameId, ALICE);
    expect(now.round).toMatchObject({ state: "playing" });
    expect(now.round!.answer).toBeUndefined();
  });

  it("still lets the player zoom out at the cap, and guesses stay refused after it", async () => {
    const { deps, view } = await atCap();
    expect(view.round!.levelCount).toBeGreaterThan(1);
    const zoomed = await play(deps, view, { type: "reveal" });
    expect(zoomed.round).toMatchObject({ state: "playing", revealLevel: 1, wrongGuesses: MAX_WRONG_GUESSES_PER_ROUND });
    expect(zoomed.revision).toBe(view.revision + 1);
    await expect(play(deps, zoomed, { type: "guess", guess: WRONG })).rejects.toThrow(GuessLimitError);
  });

  it("still lets the player skip at the cap and move on; the next round starts with no wrong guesses", async () => {
    const { deps, view } = await atCap();
    const skipped = await play(deps, view, { type: "skip" });
    expect(skipped.round).toMatchObject({ state: "skipped", answer: PUZZLES[0]!.answer });
    expect(skipped.results[0]).toMatchObject({ outcome: "skipped", points: CONFIG.skipPoints });
    const next = await play(deps, skipped, { type: "next" });
    expect(next.round).toMatchObject({ position: 2, state: "playing", wrongGuesses: 0 });
    // The cap is per round: guessing works again.
    const guessed = await play(deps, next, { type: "guess", guess: PUZZLES[1]!.answer });
    expect(guessed.round).toMatchObject({ state: "correct" });
  });

  it("still checks the owner and the revision first: a stranger gets not-found, a stale tab a conflict", async () => {
    const { deps, view } = await atCap();
    const guess: GameAction = { type: "guess", guess: WRONG };
    await expect(act(deps, view.gameId, BOB, guess, view.revision)).rejects.toThrow(GameNotFoundError);
    await expect(act(deps, view.gameId, ALICE, guess, view.revision - 1)).rejects.toThrow(GameConflictError);
  });

  it("bounds a game's stored events: no round keeps more than the cap's wrong guesses", async () => {
    const { deps, store } = setup();
    let view = await startGame(deps, PACK, ALICE, CONFIG);
    for (let round = 0; round < PUZZLES.length; round++) {
      view = await wrongGuesses(deps, view, MAX_WRONG_GUESSES_PER_ROUND);
      for (let i = 0; i < 3; i++) {
        await expect(play(deps, view, { type: "guess", guess: `${WRONG} ${i}` })).rejects.toThrow(GuessLimitError);
      }
      view = await play(deps, view, { type: "skip" });
      view = await play(deps, view, { type: "next" });
    }
    expect(view.finished).toBe(true);
    const { events } = stateOf(store, view.gameId);
    // Per round: the cap's wrong guesses plus the skip (no zoom outs here).
    expect(events).toHaveLength(PUZZLES.length * (MAX_WRONG_GUESSES_PER_ROUND + 1));
    for (const puzzle of PUZZLES) {
      expect(events.filter((e) => e.type === "wrongGuess" && e.puzzleId === puzzle.id)).toHaveLength(
        MAX_WRONG_GUESSES_PER_ROUND,
      );
    }
  });
});

describe("the stored wrong-guess penalty can't overflow (#236)", () => {
  const INTEGER_MAX = 2_147_483_647; // Postgres `integer` (rounds.wrong_guess_penalty)

  // The cap (#209) is what bounds it: its own tests check the next guess is refused.
  it("fits in an integer column at the guess cap and the largest allowed penalty", () => {
    const config: ScoringConfig = {
      basePoints: MAX_SCORING_VALUE,
      revealPenalty: MAX_SCORING_VALUE,
      wrongGuessPenalty: MAX_SCORING_VALUE,
      minPoints: 0,
      skipPoints: 0,
    };
    const events = [
      ...Array.from({ length: MAX_WRONG_GUESSES_PER_ROUND }, () => ({ type: "wrongGuess" as const, puzzleId: "p1" })),
      { type: "correct" as const, puzzleId: "p1", revealLevel: 0 },
    ];
    const { breakdown } = scoreRound(events, config);
    expect(breakdown.wrongGuessPenalty).toBe(MAX_WRONG_GUESSES_PER_ROUND * MAX_SCORING_VALUE);
    expect(breakdown.wrongGuessPenalty).toBeLessThanOrEqual(INTEGER_MAX);
  });
});
