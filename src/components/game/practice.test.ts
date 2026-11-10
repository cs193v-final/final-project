import { describe, expect, it } from "vitest";
import type { Puzzle } from "@/game/types";
import { initPractice, practiceReducer, type PracticeAction, type PracticeState } from "./practice";

function puzzle(id: string, answer: string): Puzzle {
  return {
    id,
    imageUrl: "",
    answer,
    acceptedAnswers: [],
    reveal: { focus: { x: 0.5, y: 0.5 }, zoomLevels: [4, 2, 1] },
    credit: { source: "test", license: "CC0" },
  };
}
const PUZZLES = [puzzle("p1", "Eiffel Tower"), puzzle("p2", "Big Ben")];

function run(...actions: PracticeAction[]): PracticeState {
  return actions.reduce(practiceReducer, initPractice(PUZZLES));
}

describe("practiceReducer", () => {
  it("starts with no feedback and no events", () => {
    const s = initPractice(PUZZLES);
    expect(s.feedback).toEqual({ kind: "none" });
    expect(s.events).toEqual([]);
  });

  it("a wrong guess shows the normalized guess and records a wrongGuess event", () => {
    const s = run({ type: "guess", guess: "  The LOUVRE " });
    expect(s.feedback).toEqual({ kind: "incorrect", guess: "the louvre", wrongGuesses: 1 });
    expect(s.events).toEqual([{ type: "wrongGuess", puzzleId: "p1" }]);
    expect(s.game.round.state).toBe("playing");
  });

  it("a blank guess shows a hint without an event", () => {
    const s = run({ type: "guess", guess: "   " });
    expect(s.feedback).toEqual({ kind: "empty" });
    expect(s.events).toEqual([]);
  });

  it("a correct guess shows the canonical answer and what matched", () => {
    const s = run({ type: "guess", guess: "eiffel tower" });
    expect(s.feedback).toEqual({ kind: "correct", answer: "Eiffel Tower", matched: "Eiffel Tower" });
    expect(s.game.round.state).toBe("correct");
  });

  it("skipping reveals the answer", () => {
    const s = run({ type: "skip" });
    expect(s.feedback).toEqual({ kind: "skipped", answer: "Eiffel Tower" });
    expect(s.events).toEqual([{ type: "skip", puzzleId: "p1" }]);
  });

  it("next clears the feedback and moves on", () => {
    const s = run({ type: "skip" }, { type: "next" });
    expect(s.feedback).toEqual({ kind: "none" });
    expect(s.game.round.puzzleId).toBe("p2");
  });

  it("reveal keeps the current feedback and records the event", () => {
    const s = run({ type: "guess", guess: "louvre" }, { type: "reveal" });
    expect(s.feedback).toEqual({ kind: "incorrect", guess: "louvre", wrongGuesses: 1 });
    expect(s.events.at(-1)).toEqual({ type: "reveal", puzzleId: "p1", revealLevel: 1 });
  });

  it("ignores rejected actions without changing state", () => {
    const after = run({ type: "skip" });
    expect(practiceReducer(after, { type: "guess", guess: "x" })).toBe(after);
    const start = initPractice(PUZZLES);
    expect(practiceReducer(start, { type: "next" })).toBe(start);
  });

  it("restart starts over with the same puzzles", () => {
    const s = run({ type: "skip" }, { type: "next" }, { type: "skip" }, { type: "next" }, { type: "restart" });
    expect(s.game.finished).toBe(false);
    expect(s.game.round.puzzleId).toBe("p1");
    expect(s.events).toEqual([]);
  });
});
