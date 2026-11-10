import { describe, expect, it } from "vitest";
import { createGame, step, type GameAction } from "./round.ts";
import { pointsIfCorrect, scoreGame, scoreRound, validateScoringConfig } from "./scoring.ts";
import { SCORING_CONFIG } from "./scoring-config.ts";
import type { Puzzle, ScoringConfig, ScoringEvent } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks SCORING_CONFIG.
const CONFIG: ScoringConfig = {
  basePoints: 100,
  revealPenalty: 20,
  wrongGuessPenalty: 10,
  minPoints: 10,
  skipPoints: 0,
};

const reveal = (puzzleId: string, revealLevel: number): ScoringEvent => ({ type: "reveal", puzzleId, revealLevel });
const wrong = (puzzleId: string): ScoringEvent => ({ type: "wrongGuess", puzzleId });
const correct = (puzzleId: string, revealLevel: number): ScoringEvent => ({ type: "correct", puzzleId, revealLevel });
const skip = (puzzleId: string): ScoringEvent => ({ type: "skip", puzzleId });

describe("scoreRound: correct answers", () => {
  it("gives full base points with no zoom-outs or misses", () => {
    expect(scoreRound([correct("p1", 0)], CONFIG)).toEqual({
      puzzleId: "p1",
      outcome: "correct",
      revealLevelReached: 0,
      wrongGuesses: 0,
      points: 100,
      breakdown: { base: 100, revealPenalty: 0, wrongGuessPenalty: 0 },
    });
  });

  it("subtracts a penalty per zoom-out and per wrong guess", () => {
    const result = scoreRound([reveal("p1", 1), wrong("p1"), reveal("p1", 2), correct("p1", 2)], CONFIG);
    expect(result.revealLevelReached).toBe(2);
    expect(result.wrongGuesses).toBe(1);
    expect(result.breakdown).toEqual({ base: 100, revealPenalty: 40, wrongGuessPenalty: 10 });
    expect(result.points).toBe(50);
  });

  it("never goes below minPoints", () => {
    const misses = Array.from({ length: 9 }, () => wrong("p1"));
    const result = scoreRound([reveal("p1", 1), reveal("p1", 2), reveal("p1", 3), ...misses, correct("p1", 3)], CONFIG);
    expect(result.breakdown).toEqual({ base: 100, revealPenalty: 60, wrongGuessPenalty: 90 });
    expect(result.points).toBe(10);
  });

  it("uses the correct event's reveal level even without reveal events", () => {
    expect(scoreRound([correct("p1", 2)], CONFIG).points).toBe(60);
  });
});

describe("scoreRound: skips", () => {
  it("earns skipPoints and no penalties, but still records what happened", () => {
    expect(scoreRound([reveal("p1", 1), wrong("p1"), skip("p1")], { ...CONFIG, skipPoints: 5 })).toEqual({
      puzzleId: "p1",
      outcome: "skipped",
      revealLevelReached: 1,
      wrongGuesses: 1,
      points: 5,
      breakdown: { base: 5, revealPenalty: 0, wrongGuessPenalty: 0 },
    });
  });
});

describe("scoreRound: bad input", () => {
  it("rejects no events", () => {
    expect(() => scoreRound([], CONFIG)).toThrow(/no events/);
  });
  it("rejects a round that hasn't ended", () => {
    expect(() => scoreRound([reveal("p1", 1), wrong("p1")], CONFIG)).toThrow(/hasn't ended/);
  });
  it("rejects events from more than one puzzle", () => {
    expect(() => scoreRound([wrong("p1"), correct("p2", 0)], CONFIG)).toThrow(/mix puzzles/);
  });
  it("rejects events after the round ended", () => {
    expect(() => scoreRound([skip("p1"), wrong("p1")], CONFIG)).toThrow(/after the round ended/);
  });
});

describe("scoreGame", () => {
  it("scores each round and keeps a running total", () => {
    const score = scoreGame(
      [correct("p1", 0), reveal("p2", 1), wrong("p2"), correct("p2", 1), reveal("p3", 1), skip("p3")],
      CONFIG,
    );
    expect(score.rounds.map((r) => [r.puzzleId, r.outcome, r.points])).toEqual([
      ["p1", "correct", 100],
      ["p2", "correct", 70],
      ["p3", "skipped", 0],
    ]);
    expect(score.total).toBe(170);
    expect(score.current).toBeUndefined();
  });

  it("starts at zero with no events", () => {
    expect(scoreGame([], CONFIG)).toEqual({ rounds: [], total: 0 });
  });

  it("reports the round in progress for the live score", () => {
    const score = scoreGame([correct("p1", 0), reveal("p2", 1), wrong("p2")], CONFIG);
    expect(score.total).toBe(100);
    expect(score.current).toEqual({ puzzleId: "p2", revealLevel: 1, wrongGuesses: 1, pointsIfCorrect: 70 });
  });

  it("rejects a new puzzle's events before the previous round ended", () => {
    expect(() => scoreGame([wrong("p1"), wrong("p2")], CONFIG)).toThrow(/didn't end/);
  });
});

describe("pointsIfCorrect", () => {
  it("matches the scoring rule, with the floor", () => {
    expect(pointsIfCorrect(0, 0, CONFIG)).toBe(100);
    expect(pointsIfCorrect(3, 0, CONFIG)).toBe(40);
    expect(pointsIfCorrect(3, 20, CONFIG)).toBe(10);
  });
});

describe("validateScoringConfig", () => {
  it("accepts the game's current config", () => {
    expect(() => validateScoringConfig(SCORING_CONFIG)).not.toThrow();
  });
  it("rejects negative or non-numeric values", () => {
    expect(() => validateScoringConfig({ ...CONFIG, revealPenalty: -5 })).toThrow(/revealPenalty/);
    expect(() => validateScoringConfig({ ...CONFIG, basePoints: Number.NaN })).toThrow(/basePoints/);
  });
  it("rejects a floor above the base", () => {
    expect(() => validateScoringConfig({ ...CONFIG, minPoints: 200 })).toThrow(/minPoints/);
  });
  it("is checked before scoring", () => {
    expect(() => scoreRound([correct("p1", 0)], { ...CONFIG, minPoints: 200 })).toThrow(/minPoints/);
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
  });

  it("scores the events step() emits for a full three-image game", () => {
    let game = createGame([puzzle("p1", "Eiffel Tower"), puzzle("p2", "Big Ben"), puzzle("p3", "Colosseum")]);
    const events: ScoringEvent[] = [];
    const actions: GameAction[] = [
      { type: "guess", guess: "eiffel tower" },
      { type: "next" },
      { type: "reveal" },
      { type: "reveal" },
      { type: "guess", guess: "london eye" },
      { type: "guess", guess: "Big Ben" },
      { type: "next" },
      { type: "reveal" },
      { type: "skip" },
      { type: "next" },
    ];
    for (const action of actions) {
      const result = step(game, action);
      expect(result.ok).toBe(true);
      game = result.game;
      events.push(...result.events);
    }
    expect(game.finished).toBe(true);

    const score = scoreGame(events, CONFIG);
    expect(score.rounds.map((r) => r.points)).toEqual([100, 50, 0]);
    expect(score.total).toBe(150);
  });
});
