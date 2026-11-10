// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RoundResult } from "@/game/types";
import { actionsText, breakdownText, FinalScore } from "./FinalScore";

function result(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    puzzleId: "p1",
    outcome: "correct",
    revealLevelReached: 0,
    wrongGuesses: 0,
    points: 100,
    breakdown: { base: 100, revealPenalty: 0, wrongGuessPenalty: 0 },
    ...overrides,
  };
}

describe("breakdownText", () => {
  it("shows just the base with no penalties", () => {
    expect(breakdownText(result())).toBe("100");
  });

  it("lists each penalty that applied", () => {
    const r = result({ points: 50, breakdown: { base: 100, revealPenalty: 40, wrongGuessPenalty: 10 } });
    expect(breakdownText(r)).toBe("100 − 40 for zoom-outs − 10 for wrong guesses");
  });

  it("says when the minimum kicked in", () => {
    const r = result({ points: 10, breakdown: { base: 100, revealPenalty: 60, wrongGuessPenalty: 90 } });
    expect(breakdownText(r)).toBe("100 − 60 for zoom-outs − 90 for wrong guesses (minimum applied)");
  });

  it("says Skipped for a skip", () => {
    expect(breakdownText(result({ outcome: "skipped", points: 0 }))).toBe("Skipped");
  });
});

describe("actionsText", () => {
  it("uses singular and plural correctly", () => {
    expect(actionsText(result({ revealLevelReached: 1, wrongGuesses: 1 }))).toBe("1 zoom-out, 1 wrong guess");
    expect(actionsText(result({ revealLevelReached: 2, wrongGuesses: 0 }))).toBe("2 zoom-outs, 0 wrong guesses");
  });
});

describe("FinalScore", () => {
  const puzzles = [
    { id: "p1", answer: "Giraffe" },
    { id: "p2", answer: "Strawberry" },
  ];
  const score = {
    rounds: [
      result({ puzzleId: "p1", points: 70, revealLevelReached: 1, wrongGuesses: 1, breakdown: { base: 100, revealPenalty: 20, wrongGuessPenalty: 10 } }),
      result({ puzzleId: "p2", outcome: "skipped", points: 0 }),
    ],
    total: 70,
  };

  it("shows the total out of the maximum and a line per image, and focuses the heading", () => {
    render(<FinalScore puzzles={puzzles} score={score} onPlayAgain={() => {}} />);
    const heading = screen.getByRole("heading", { name: "Practice complete" });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/You scored/)).toHaveTextContent("You scored 70 out of 200");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1. Giraffe ✓ correct");
    expect(items[0]).toHaveTextContent("100 − 20 for zoom-outs − 10 for wrong guesses");
    expect(items[1]).toHaveTextContent("2. Strawberry skipped");
  });

  it("calls onPlayAgain", async () => {
    const onPlayAgain = vi.fn();
    render(<FinalScore puzzles={puzzles} score={score} onPlayAgain={onPlayAgain} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Play again" }));
    expect(onPlayAgain).toHaveBeenCalledOnce();
  });
});
