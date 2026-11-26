import { describe, expect, it } from "vitest";
import { createGame, START_GRACE_SECONDS, step, timeOut, type Game, type GameAction, type RoundClock } from "./round.ts";
import { MAX_SCORING_VALUE, scoreAt, scoreGame, scoreRound, validateScoringConfig, validateTimedScoringConfig } from "./scoring.ts";
import { SCORING_CONFIG } from "./scoring-config.ts";
import type { Puzzle, ScoringConfig, ScoringEvent, TimedScoringConfig } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const TIMED: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

const wrong = (puzzleId: string): ScoringEvent => ({ type: "wrongGuess", puzzleId });
const correct = (puzzleId: string, seconds: number): ScoringEvent => ({ type: "correct", puzzleId, seconds });
const timedOut = (puzzleId: string): ScoringEvent => ({ type: "timeOut", puzzleId });

describe("scoreRound: timed rounds (#255)", () => {
  it("scores a correct guess by its time with scoreAt", () => {
    expect(scoreRound([correct("p1", 0)], TIMED)).toEqual({
      puzzleId: "p1",
      outcome: "correct",
      seconds: 0,
      wrongGuesses: 0,
      points: 10_000,
    });
    expect(scoreRound([correct("p1", 12.5)], TIMED).points).toBe(2_575);
    expect(scoreRound([correct("p1", 6.2)], TIMED).points).toBe(scoreAt(6.2, TIMED));
  });

  it("gives the floor of minPoints between the clear time and the limit", () => {
    expect(scoreRound([correct("p1", 25)], TIMED).points).toBe(100);
    expect(scoreRound([correct("p1", 29.9)], TIMED).points).toBe(100);
  });

  it("counts wrong guesses, but they cost nothing", () => {
    const result = scoreRound([wrong("p1"), wrong("p1"), correct("p1", 5)], TIMED);
    expect(result).toMatchObject({ wrongGuesses: 2, points: scoreAt(5, TIMED) });
  });

  it("gives 0 for a time-out, at the limit's time", () => {
    expect(scoreRound([wrong("p1"), timedOut("p1")], TIMED)).toEqual({
      puzzleId: "p1",
      outcome: "timedOut",
      seconds: 30,
      wrongGuesses: 1,
      points: 0,
    });
  });
});

describe("scoreRound: bad input", () => {
  it("rejects no events", () => {
    expect(() => scoreRound([], TIMED)).toThrow(/no events/);
  });
  it("rejects a round that hasn't ended", () => {
    expect(() => scoreRound([wrong("p1")], TIMED)).toThrow(/hasn't ended/);
  });
  it("rejects events from more than one puzzle", () => {
    expect(() => scoreRound([wrong("p1"), correct("p2", 1)], TIMED)).toThrow(/mix puzzles/);
  });
  it("rejects events after the round ended", () => {
    expect(() => scoreRound([correct("p1", 1), wrong("p1")], TIMED)).toThrow(/after the round ended/);
    expect(() => scoreRound([timedOut("p1"), correct("p1", 1)], TIMED)).toThrow(/after the round ended/);
  });
  it("checks the config first", () => {
    expect(() => scoreRound([correct("p1", 1)], { ...TIMED, curve: 0 })).toThrow(/curve/);
  });
});

describe("scoreGame", () => {
  it("scores each round and keeps a running total", () => {
    const { rounds, total } = scoreGame(
      [correct("p1", 0), wrong("p2"), timedOut("p2"), correct("p3", 12.5)],
      TIMED,
    );
    expect(rounds.map((r) => [r.outcome, r.points])).toEqual([
      ["correct", 10_000],
      ["timedOut", 0],
      ["correct", 2_575],
    ]);
    expect(total).toBe(12_575);
  });

  it("starts at zero with no events", () => {
    expect(scoreGame([], TIMED)).toEqual({ rounds: [], total: 0 });
  });

  it("leaves a round that hasn't ended out of the total", () => {
    const { rounds, total } = scoreGame([correct("p1", 0), wrong("p2")], TIMED);
    expect(rounds).toHaveLength(1);
    expect(total).toBe(10_000);
  });

  it("rejects a new puzzle's events before the previous round ended", () => {
    expect(() => scoreGame([wrong("p1"), correct("p2", 1)], TIMED)).toThrow(/didn't end/);
  });
});

// The old zoom-out shape, still used by per-pack overrides (#64) until they move to the timed fields (#256).
const OLD: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };

describe("validateScoringConfig (per-pack overrides, old shape)", () => {
  it("accepts the default config", () => {
    expect(() => validateScoringConfig(SCORING_CONFIG)).not.toThrow();
  });
  it("rejects negative or non-numeric values", () => {
    expect(() => validateScoringConfig({ ...OLD, revealPenalty: -5 })).toThrow(/revealPenalty/);
    expect(() => validateScoringConfig({ ...OLD, basePoints: Number.NaN })).toThrow(/basePoints/);
  });
  it("rejects fractions and values too big for the integer columns (#76 review)", () => {
    expect(() => validateScoringConfig({ ...OLD, revealPenalty: 12.5 })).toThrow(/revealPenalty.*whole number/);
    expect(() => validateScoringConfig({ ...OLD, basePoints: 1e300 })).toThrow(/basePoints/);
    expect(() => validateScoringConfig({ ...OLD, basePoints: MAX_SCORING_VALUE + 1 })).toThrow(/basePoints/);
    expect(() => validateScoringConfig({ ...OLD, basePoints: MAX_SCORING_VALUE })).not.toThrow();
  });
  it("caps each field so a game's total can't overflow games.total (#174)", () => {
    const INTEGER_MAX = 2_147_483_647; // Postgres `integer`
    // Fit in one column, but two correct rounds overflowed the sum before #174.
    expect(() => validateTimedScoringConfig({ ...TIMED, maxPoints: 2_000_000_000 })).toThrow(
      /maxPoints must be a whole number from 0 to 1000000/,
    );
    expect(MAX_SCORING_VALUE).toBe(1_000_000);
    // At the cap, a 2,147-round game still fits (as the doc comment says).
    expect(MAX_SCORING_VALUE * 2_147).toBeLessThan(INTEGER_MAX);
    for (const key of ["maxPoints", "minPoints"] as const) {
      expect(() => validateTimedScoringConfig({ ...TIMED, [key]: MAX_SCORING_VALUE + 1 }), key).toThrow(
        new RegExp(key),
      );
    }
  });
  it("rejects a floor above the base", () => {
    expect(() => validateScoringConfig({ ...OLD, minPoints: 200 })).toThrow(/minPoints/);
  });
  it("rejects a skip worth more than the worst correct answer", () => {
    expect(() => validateScoringConfig({ ...OLD, skipPoints: 50 })).toThrow(/skipPoints/);
    expect(() => validateScoringConfig({ ...OLD, skipPoints: 10 })).not.toThrow();
  });
});

describe("with the real round logic", () => {
  const puzzle = (id: string, answer: string): Puzzle => ({
    id,
    imageUrl: `/puzzles/${id}.jpg`,
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "test", license: "CC0" },
    aiSolvedLevel: null,
  });
  const T0 = Date.UTC(2030, 0, 1);
  const clock = (ms: number): RoundClock => ({ now: T0 + ms, scoring: TIMED });

  it("scores the events step() and timeOut() emit for a full three-image game", () => {
    let game: Game = createGame([puzzle("p1", "Eiffel Tower"), puzzle("p2", "Big Ben"), puzzle("p3", "Colosseum")]);
    const events: ScoringEvent[] = [];
    let now = 0;
    const run = (action: GameAction, ms = 0) => {
      now += ms;
      const result = step(game, action, clock(now));
      if (!result.ok) throw new Error(`${action.type}: ${result.reason}`);
      game = result.game;
      events.push(...result.events);
    };
    const grace = START_GRACE_SECONDS * 1000;
    // Round 1: right at 2 s.
    run({ type: "start" });
    run({ type: "guess", guess: "eiffel tower" }, 2000 + grace);
    run({ type: "next" });
    // Round 2: a wrong guess, then the time runs out.
    run({ type: "start" });
    run({ type: "guess", guess: "zebra" }, 1000);
    now += 40_000;
    const expired = timeOut(game, clock(now))!;
    game = expired.game;
    events.push(...expired.events);
    run({ type: "next" });
    // Round 3: right at 26 s (after the clear time: the floor).
    run({ type: "start" });
    run({ type: "guess", guess: "colosseum" }, 26_000 + grace);

    const { rounds, total } = scoreGame(events, TIMED);
    expect(rounds).toEqual([
      { puzzleId: "p1", outcome: "correct", seconds: 2, wrongGuesses: 0, points: scoreAt(2, TIMED) },
      { puzzleId: "p2", outcome: "timedOut", seconds: 30, wrongGuesses: 1, points: 0 },
      { puzzleId: "p3", outcome: "correct", seconds: 26, wrongGuesses: 0, points: 100 },
    ]);
    expect(total).toBe(scoreAt(2, TIMED) + 100);
  });
});
