// Timed rounds (#255): the round state machine with an explicit clock.
import { describe, expect, it } from "vitest";
import {
  createGame,
  currentPuzzle,
  elapsedSeconds,
  isOverdue,
  START_GRACE_SECONDS,
  step,
  timeOut,
  type Game,
  type GameAction,
  type RoundClock,
} from "./round.ts";
import type { Puzzle, ScoringEvent, TimedScoringConfig } from "./types.ts";

function puzzle(id: string, answer: string): Puzzle {
  return {
    id,
    imageUrl: `/puzzles/${id}.jpg`,
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "test", license: "CC0" },
    aiSolvedLevel: null,
  };
}

const PUZZLES = [puzzle("p1", "Eiffel Tower"), puzzle("p2", "Big Ben"), puzzle("p3", "Colosseum")];

// Fixed numbers so these tests don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const SCORING: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

const T0 = Date.UTC(2030, 0, 1, 12);
/** The clock `seconds` of round time after a start at T0 (the grace added back, so `elapsedSeconds` is exactly `seconds`). */
const at = (seconds: number): RoundClock => ({ now: T0 + (seconds + START_GRACE_SECONDS) * 1000, scoring: SCORING });
const START: RoundClock = { now: T0, scoring: SCORING };

/** Apply actions in order at one clock, failing the test if any is rejected. Returns the game and all events. */
function play(game: Game, clock: RoundClock, ...actions: GameAction[]): { game: Game; events: ScoringEvent[] } {
  const events: ScoringEvent[] = [];
  for (const action of actions) {
    const result = step(game, action, clock);
    if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
    game = result.game;
    events.push(...result.events);
  }
  return { game, events };
}

/** A game whose first round's clock started at T0. */
function started(): Game {
  return play(createGame(PUZZLES), START, { type: "start" }).game;
}

function reason(game: Game, action: GameAction, clock: RoundClock): string | undefined {
  const result = step(game, action, clock);
  return result.ok ? undefined : result.reason;
}

describe("createGame", () => {
  it("starts on the first puzzle, ready: no clock running yet", () => {
    const game = createGame(PUZZLES);
    expect(game.index).toBe(0);
    expect(game.finished).toBe(false);
    expect(game.round).toEqual({ puzzleId: "p1", state: "ready", startedAt: null, wrongGuesses: 0 });
    expect(currentPuzzle(game).id).toBe("p1");
  });

  it("rejects unplayable data", () => {
    expect(() => createGame([])).toThrow(/at least one/);
    expect(() => createGame([puzzle("p1", "x"), puzzle("p1", "y")])).toThrow(/duplicate/);
  });
});

describe("start", () => {
  it("starts the clock at the server's time, with no scoring event", () => {
    const { game, events } = play(createGame(PUZZLES), START, { type: "start" });
    expect(game.round).toMatchObject({ state: "playing", startedAt: T0 });
    expect(events).toEqual([]);
  });

  it("is refused while the clock is running, and after the round", () => {
    const game = started();
    expect(reason(game, { type: "start" }, at(1))).toBe("already-started");
    const solved = play(game, at(2), { type: "guess", guess: "eiffel tower" }).game;
    expect(reason(solved, { type: "start" }, at(3))).toBe("round-over");
  });
});

describe("elapsedSeconds", () => {
  it("is null before the start", () => {
    expect(elapsedSeconds(createGame(PUZZLES).round, T0)).toBeNull();
  });

  it("takes off the grace for the network, never going below 0", () => {
    const { round } = started();
    expect(START_GRACE_SECONDS).toBe(0.5);
    expect(elapsedSeconds(round, T0)).toBe(0);
    expect(elapsedSeconds(round, T0 + 300)).toBe(0);
    expect(elapsedSeconds(round, T0 + 6_700)).toBe(6.2);
    expect(elapsedSeconds(round, T0 - 5_000)).toBe(0); // a clock that went back doesn't go negative
  });

  it("is rounded to the millisecond, so the stored time and its points agree", () => {
    const { round } = started();
    expect(elapsedSeconds(round, T0 + 1234.5678)).toBe(0.735);
  });
});

describe("guess", () => {
  it("is refused before the start (no photo yet)", () => {
    expect(reason(createGame(PUZZLES), { type: "guess", guess: "eiffel tower" }, START)).toBe("not-started");
  });

  it("correct: ends the round with the server's elapsed time in the event", () => {
    const { game, events } = play(started(), at(6.2), { type: "guess", guess: "eiffel tower" });
    expect(game.round.state).toBe("correct");
    expect(events).toEqual([{ type: "correct", puzzleId: "p1", seconds: 6.2 }]);
  });

  it("wrong: counted, costs nothing, and the round keeps playing", () => {
    const { game, events } = play(started(), at(3), { type: "guess", guess: "big ben" }, { type: "guess", guess: "louvre" });
    expect(game.round).toMatchObject({ state: "playing", wrongGuesses: 2 });
    expect(events).toEqual([
      { type: "wrongGuess", puzzleId: "p1" },
      { type: "wrongGuess", puzzleId: "p1" },
    ]);
  });

  it("returns the outcome", () => {
    const result = step(started(), { type: "guess", guess: "zebra" }, at(1));
    expect(result.ok && result.outcome).toEqual({ kind: "incorrect", normalizedGuess: "zebra" });
  });

  it("ignores a blank guess", () => {
    expect(reason(started(), { type: "guess", guess: "  " }, at(1))).toBe("empty-guess");
  });

  it("is accepted just before the limit and refused at it (time-up)", () => {
    const game = started();
    expect(step(game, { type: "guess", guess: "eiffel tower" }, at(29.999)).ok).toBe(true);
    expect(reason(game, { type: "guess", guess: "eiffel tower" }, at(30))).toBe("time-up");
    expect(reason(game, { type: "guess", guess: "zebra" }, at(45))).toBe("time-up");
  });

  it("is refused after the round is over", () => {
    const solved = play(started(), at(2), { type: "guess", guess: "eiffel tower" }).game;
    expect(reason(solved, { type: "guess", guess: "zebra" }, at(3))).toBe("round-over");
  });
});

describe("timeOut", () => {
  it("does nothing before the limit, before the start, or after the round", () => {
    expect(timeOut(started(), at(29.999))).toBeNull();
    expect(timeOut(createGame(PUZZLES), at(100))).toBeNull();
    const solved = play(started(), at(2), { type: "guess", guess: "eiffel tower" }).game;
    expect(timeOut(solved, at(100))).toBeNull();
  });

  it("ends a playing round at the limit with a timeOut event", () => {
    const game = started();
    expect(isOverdue(game.round, at(30))).toBe(true);
    const expired = timeOut(game, at(30));
    expect(expired?.game.round).toMatchObject({ state: "timedOut", wrongGuesses: 0 });
    expect(expired?.events).toEqual([{ type: "timeOut", puzzleId: "p1" }]);
  });

  it("keeps the round's wrong guesses", () => {
    const game = play(started(), at(1), { type: "guess", guess: "zebra" }).game;
    expect(timeOut(game, at(31))?.game.round.wrongGuesses).toBe(1);
  });
});

describe("next", () => {
  it("is refused while the round is ready or playing (there is no skip)", () => {
    expect(reason(createGame(PUZZLES), { type: "next" }, START)).toBe("round-in-progress");
    expect(reason(started(), { type: "next" }, at(5))).toBe("round-in-progress");
  });

  it("moves on after a correct guess to a fresh, ready round", () => {
    const solved = play(started(), at(2), { type: "guess", guess: "eiffel tower" }).game;
    const { game, events } = play(solved, at(3), { type: "next" });
    expect(game.index).toBe(1);
    expect(game.round).toEqual({ puzzleId: "p2", state: "ready", startedAt: null, wrongGuesses: 0 });
    expect(events).toEqual([]);
  });

  it("moves on after a time-out", () => {
    const expired = timeOut(started(), at(30))!.game;
    expect(play(expired, at(31), { type: "next" }).game.round.puzzleId).toBe("p2");
  });

  it("finishes the game after the last round; every action is refused after that", () => {
    let game = createGame([puzzle("p1", "Eiffel Tower")]);
    game = play(game, START, { type: "start" }).game;
    game = play(game, at(1), { type: "guess", guess: "eiffel tower" }, { type: "next" }).game;
    expect(game.finished).toBe(true);
    for (const action of [{ type: "start" }, { type: "next" }, { type: "guess", guess: "x" }] as const) {
      expect(reason(game, action, at(2))).toBe("game-finished");
    }
  });
});

describe("step is pure", () => {
  it("never changes the game it was given", () => {
    const game = started();
    const copy = structuredClone(game.round);
    step(game, { type: "guess", guess: "eiffel tower" }, at(1));
    step(game, { type: "guess", guess: "zebra" }, at(1));
    timeOut(game, at(40));
    expect(game.round).toEqual(copy);
  });
});
