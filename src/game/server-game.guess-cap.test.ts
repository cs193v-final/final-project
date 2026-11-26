// The wrong-guess safety cap (#209, #85): a round stores at most
// MAX_WRONG_GUESSES_PER_ROUND wrong guesses, so a game's stored state can't
// grow without limit. It's not a gameplay limit: at the cap every further
// guess in the round is refused, a correct one too, and the round ends when
// its time runs out (timed rounds, #255). Wrong guesses cost nothing.
import { describe, expect, it } from "vitest";
import { SAMPLE_PUZZLES } from "../puzzles/index.ts";
import { START_GRACE_SECONDS } from "./round.ts";
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
import type { GameAction, GameView, Pack, Puzzle, TimedScoringConfig } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

const ALICE: GameOwner = { userId: "alice" };
const BOB: GameOwner = { userId: "bob" };

const PUZZLES: Puzzle[] = SAMPLE_PUZZLES.map((p, i) => ({ ...p, id: `p${i + 1}`, imageUrl: `/img/p${i + 1}.jpg` }));
const PACK: Pack = { id: "practice", kind: "practice", title: "Practice", theme: "Mixed", puzzleIds: PUZZLES.map((p) => p.id) };

/** A guess that is wrong for every sample and isn't a substring of any answer. */
const WRONG = "zzz definitely wrong";

function setup() {
  let n = 0;
  let now = Date.UTC(2030, 0, 1, 12);
  const store = new MemoryGameStore(() => `game-${++n}`);
  const deps: GameDeps = { games: store, puzzles: puzzleSourceFrom(PUZZLES), now: () => now };
  return { store, deps, advance: (seconds: number) => (now += seconds * 1000) };
}

async function play(deps: GameDeps, view: GameView, action: GameAction): Promise<GameView> {
  return act(deps, view.gameId, ALICE, action, view.revision);
}

async function wrongGuesses(deps: GameDeps, view: GameView, count: number): Promise<GameView> {
  for (let i = 0; i < count; i++) view = await play(deps, view, { type: "guess", guess: WRONG });
  return view;
}

/** A new game whose first round is started and has exactly MAX_WRONG_GUESSES_PER_ROUND wrong guesses. */
async function atCap() {
  const s = setup();
  const started = await play(s.deps, await startGame(s.deps, PACK, ALICE, CONFIG), { type: "start" });
  const view = await wrongGuesses(s.deps, started, MAX_WRONG_GUESSES_PER_ROUND);
  return { ...s, view };
}

function stateOf(store: MemoryGameStore, id: string): GameState {
  return (JSON.parse(store.raw(id)!) as { state: GameState }).state;
}

describe("MAX_WRONG_GUESSES_PER_ROUND (#209)", () => {
  it("is a safety cap far above what a player makes, not a gameplay limit", () => {
    expect(MAX_WRONG_GUESSES_PER_ROUND).toBe(50);
  });

  it("accepts the 50th wrong guess: counted and saved, and it costs nothing", async () => {
    const { view } = await atCap();
    expect(view.round).toMatchObject({ state: "playing", wrongGuesses: MAX_WRONG_GUESSES_PER_ROUND });
    expect(view.revision).toBe(MAX_WRONG_GUESSES_PER_ROUND + 1); // the start, then the guesses
    expect(view.lastOutcome).toMatchObject({ kind: "incorrect" });
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

  it("refuses a correct answer at the cap too, so the round stays in play until its time runs out", async () => {
    const { deps, store, view } = await atCap();
    const before = store.raw(view.gameId);
    await expect(play(deps, view, { type: "guess", guess: PUZZLES[0]!.answer })).rejects.toThrow(GuessLimitError);
    expect(store.raw(view.gameId)).toBe(before);
    const now = await getGame(deps, view.gameId, ALICE);
    expect(now.round).toMatchObject({ state: "playing" });
    expect(now.round!.answer).toBeUndefined();
  });

  it("once the time is up, a guess at the cap times the round out instead of being refused by the cap", async () => {
    const { deps, view, advance } = await atCap();
    advance(CONFIG.limitSeconds + START_GRACE_SECONDS + 1);
    const late = await play(deps, view, { type: "guess", guess: WRONG });
    expect(late.round).toMatchObject({ state: "timedOut", wrongGuesses: MAX_WRONG_GUESSES_PER_ROUND });
    expect(late.results[0]).toMatchObject({ outcome: "timedOut", points: 0 });
  });

  it("lets the player move on after the time-out; the next round starts with no wrong guesses", async () => {
    const { deps, view, advance } = await atCap();
    advance(CONFIG.limitSeconds + 1);
    const over = await getGame(deps, view.gameId, ALICE);
    let next = await play(deps, over, { type: "next" });
    expect(next.round).toMatchObject({ position: 2, state: "ready", wrongGuesses: 0 });
    // The cap is per round: guessing works again.
    next = await play(deps, next, { type: "start" });
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
    const { deps, store, advance } = setup();
    let view = await startGame(deps, PACK, ALICE, CONFIG);
    for (let round = 0; round < PUZZLES.length; round++) {
      view = await play(deps, view, { type: "start" });
      view = await wrongGuesses(deps, view, MAX_WRONG_GUESSES_PER_ROUND);
      for (let i = 0; i < 3; i++) {
        await expect(play(deps, view, { type: "guess", guess: `${WRONG} ${i}` })).rejects.toThrow(GuessLimitError);
      }
      advance(CONFIG.limitSeconds + 1);
      view = await getGame(deps, view.gameId, ALICE);
      view = await play(deps, view, { type: "next" });
    }
    expect(view.finished).toBe(true);
    const { events } = stateOf(store, view.gameId);
    // Per round: the cap's wrong guesses plus the time-out.
    expect(events).toHaveLength(PUZZLES.length * (MAX_WRONG_GUESSES_PER_ROUND + 1));
    for (const puzzle of PUZZLES) {
      expect(events.filter((e) => e.type === "wrongGuess" && e.puzzleId === puzzle.id)).toHaveLength(
        MAX_WRONG_GUESSES_PER_ROUND,
      );
    }
  });
});
