import { describe, expect, it } from "vitest";
import { createGame, currentPuzzle, step, type Game, type GameAction } from "./round.ts";
import type { Puzzle, ScoringEvent } from "./types.ts";

function puzzle(id: string, answer: string, zoomLevels = [8, 4, 2, 1]): Puzzle {
  return {
    id,
    imageUrl: `/puzzles/${id}.jpg`,
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels },
    credit: { source: "test", license: "CC0" },
  };
}

const PUZZLES = [puzzle("p1", "Eiffel Tower"), puzzle("p2", "Big Ben"), puzzle("p3", "Colosseum")];

/** Apply actions in order, failing the test if any is rejected. Returns the game and all events. */
function play(game: Game, ...actions: GameAction[]): { game: Game; events: ScoringEvent[] } {
  const events: ScoringEvent[] = [];
  for (const action of actions) {
    const result = step(game, action);
    if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
    game = result.game;
    events.push(...result.events);
  }
  return { game, events };
}

describe("createGame", () => {
  it("starts on the first puzzle, playing, at the tightest crop", () => {
    const game = createGame(PUZZLES);
    expect(game.index).toBe(0);
    expect(game.finished).toBe(false);
    expect(game.round).toEqual({
      puzzleId: "p1",
      state: "playing",
      revealLevel: 0,
      maxRevealLevel: 3,
      wrongGuesses: 0,
    });
    expect(currentPuzzle(game).id).toBe("p1");
  });

  it("rejects unplayable data", () => {
    expect(() => createGame([])).toThrow(/at least one/);
    expect(() => createGame([puzzle("p1", "x", [])])).toThrow(/no zoom levels/);
    expect(() => createGame([puzzle("p1", "x"), puzzle("p1", "y")])).toThrow(/duplicate/);
  });
});

describe("reveal", () => {
  it("goes up one level at a time and emits a reveal event with the new level", () => {
    const { game, events } = play(createGame(PUZZLES), { type: "reveal" }, { type: "reveal" });
    expect(game.round.revealLevel).toBe(2);
    expect(events).toEqual([
      { type: "reveal", puzzleId: "p1", revealLevel: 1 },
      { type: "reveal", puzzleId: "p1", revealLevel: 2 },
    ]);
  });

  it("is rejected at the full image", () => {
    const { game } = play(createGame(PUZZLES), { type: "reveal" }, { type: "reveal" }, { type: "reveal" });
    expect(game.round.revealLevel).toBe(3);
    const result = step(game, { type: "reveal" });
    expect(result).toMatchObject({ ok: false, reason: "fully-revealed", events: [] });
    expect(result.game).toBe(game);
  });

  it("is rejected for a single-level puzzle, which starts fully revealed", () => {
    const game = createGame([puzzle("p1", "x", [1])]);
    expect(step(game, { type: "reveal" })).toMatchObject({ ok: false, reason: "fully-revealed" });
  });
});

describe("guess", () => {
  it("a correct guess ends the round and emits correct at the current reveal level", () => {
    const g = play(createGame(PUZZLES), { type: "reveal" }).game;
    const result = step(g, { type: "guess", guess: "  eiffel   TOWER " });
    expect(result.ok).toBe(true);
    expect(result.game.round.state).toBe("correct");
    expect(result.events).toEqual([{ type: "correct", puzzleId: "p1", revealLevel: 1 }]);
    expect(result.ok && result.outcome).toEqual({ kind: "correct", matched: "Eiffel Tower" });
  });

  it("a wrong guess keeps playing, counts it, and emits wrongGuess", () => {
    const result = step(createGame(PUZZLES), { type: "guess", guess: "Louvre" });
    expect(result.ok).toBe(true);
    expect(result.game.round).toMatchObject({ state: "playing", wrongGuesses: 1 });
    expect(result.events).toEqual([{ type: "wrongGuess", puzzleId: "p1" }]);
    expect(result.ok && result.outcome).toEqual({ kind: "incorrect", normalizedGuess: "louvre" });
  });

  it("a blank guess is rejected and doesn't count as wrong", () => {
    const game = createGame(PUZZLES);
    const result = step(game, { type: "guess", guess: "   " });
    expect(result).toMatchObject({ ok: false, reason: "empty-guess", events: [] });
    expect(result.game.round.wrongGuesses).toBe(0);
  });

  it("passes the matcher option through to checkGuess", () => {
    const result = step(createGame(PUZZLES), { type: "guess", guess: "eiffel" }, {
      matcher: (g, a) => a.startsWith(g),
    });
    expect(result.game.round.state).toBe("correct");
  });
});

describe("skip", () => {
  it("ends the round as skipped and emits skip", () => {
    const result = step(createGame(PUZZLES), { type: "skip" });
    expect(result.game.round.state).toBe("skipped");
    expect(result.events).toEqual([{ type: "skip", puzzleId: "p1" }]);
  });
});

describe("after a round ends", () => {
  const ended = {
    correct: play(createGame(PUZZLES), { type: "guess", guess: "Eiffel Tower" }).game,
    skipped: play(createGame(PUZZLES), { type: "skip" }).game,
  };

  for (const [label, game] of Object.entries(ended)) {
    it(`rejects reveal, guess and skip once ${label}`, () => {
      for (const action of [
        { type: "reveal" },
        { type: "guess", guess: "Eiffel Tower" },
        { type: "skip" },
      ] as GameAction[]) {
        const result = step(game, action);
        expect(result).toMatchObject({ ok: false, reason: "round-over", events: [] });
        expect(result.game).toBe(game);
      }
    });
  }

  it("next moves to the following puzzle with a fresh round", () => {
    const result = step(ended.correct, { type: "next" });
    expect(result.ok).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.game.index).toBe(1);
    expect(result.game.round).toEqual({
      puzzleId: "p2",
      state: "playing",
      revealLevel: 0,
      maxRevealLevel: 3,
      wrongGuesses: 0,
    });
  });
});

describe("next", () => {
  it("is rejected while the round is still playing", () => {
    expect(step(createGame(PUZZLES), { type: "next" })).toMatchObject({
      ok: false,
      reason: "round-in-progress",
    });
  });

  it("after the last round finishes the game; every action is then rejected", () => {
    const { game } = play(
      createGame(PUZZLES),
      { type: "skip" }, { type: "next" },
      { type: "skip" }, { type: "next" },
      { type: "skip" }, { type: "next" },
    );
    expect(game.finished).toBe(true);
    expect(game.index).toBe(2); // stays on the last puzzle, so its round can still be shown
    for (const action of [{ type: "next" }, { type: "reveal" }, { type: "skip" }] as GameAction[]) {
      expect(step(game, action)).toMatchObject({ ok: false, reason: "game-finished" });
    }
  });
});

describe("a full three-image game", () => {
  it("emits the expected scoring events in order", () => {
    const { game, events } = play(
      createGame(PUZZLES),
      // p1: two reveals, one wrong guess, then correct
      { type: "reveal" },
      { type: "reveal" },
      { type: "guess", guess: "louvre" },
      { type: "guess", guess: "eiffel tower" },
      { type: "next" },
      // p2: correct straight away
      { type: "guess", guess: "big ben" },
      { type: "next" },
      // p3: one reveal, then skip
      { type: "reveal" },
      { type: "skip" },
      { type: "next" },
    );
    expect(game.finished).toBe(true);
    expect(events).toEqual([
      { type: "reveal", puzzleId: "p1", revealLevel: 1 },
      { type: "reveal", puzzleId: "p1", revealLevel: 2 },
      { type: "wrongGuess", puzzleId: "p1" },
      { type: "correct", puzzleId: "p1", revealLevel: 2 },
      { type: "correct", puzzleId: "p2", revealLevel: 0 },
      { type: "reveal", puzzleId: "p3", revealLevel: 1 },
      { type: "skip", puzzleId: "p3" },
    ]);
  });

  it("never mutates the game it was given", () => {
    const start = createGame(PUZZLES);
    const snapshot: unknown = JSON.parse(JSON.stringify(start));
    play(start, { type: "reveal" }, { type: "guess", guess: "nope" }, { type: "skip" }, { type: "next" });
    expect(start).toEqual(snapshot);
  });
});
