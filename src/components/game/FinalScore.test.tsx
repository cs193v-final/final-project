// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RoundResult } from "@/game/types";
import { actionsText, beatAiText, FinalScore, secondsText } from "./FinalScore";

function result(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    puzzleId: "p1",
    outcome: "correct",
    seconds: 0,
    wrongGuesses: 0,
    points: 10_000,
    ...overrides,
  };
}

describe("secondsText", () => {
  it("shows a round's time to a tenth of a second", () => {
    expect(secondsText(6.25)).toBe("6.3 s");
    expect(secondsText(0)).toBe("0.0 s");
  });
});

describe("actionsText (timed rounds, #255)", () => {
  it("says how long a correct guess took, and the wrong guesses, singular and plural", () => {
    expect(actionsText(result({ seconds: 6.2 }))).toBe("Got it in 6.2 s");
    expect(actionsText(result({ seconds: 3, wrongGuesses: 1 }))).toBe("Got it in 3.0 s, 1 wrong guess");
    expect(actionsText(result({ seconds: 3, wrongGuesses: 2 }))).toBe("Got it in 3.0 s, 2 wrong guesses");
  });

  it("says Time's up for a round that timed out", () => {
    expect(actionsText(result({ outcome: "timedOut", seconds: 30, points: 0 }))).toBe("Time's up");
  });
});

describe("FinalScore", () => {
  const puzzles = [
    { id: "p1", answer: "Giraffe" },
    { id: "p2", answer: "Strawberry" },
  ];
  const score = {
    rounds: [
      result({ puzzleId: "p1", points: 6_436, seconds: 5, wrongGuesses: 1 }),
      result({ puzzleId: "p2", outcome: "timedOut", seconds: 30, points: 0 }),
    ],
    total: 6_436,
  };

  it("shows the total out of the maximum and a line per image, and focuses the heading", () => {
    render(<FinalScore puzzles={puzzles} score={score} onPlayAgain={() => {}} />);
    const heading = screen.getByRole("heading", { name: "Practice complete" });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/You scored/)).toHaveTextContent("You scored 6436 out of 20000");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1. Giraffe ✓ correct");
    expect(items[0]).toHaveTextContent("Got it in 5.0 s, 1 wrong guess");
    expect(items[0]).toHaveTextContent("6436");
    expect(items[1]).toHaveTextContent("2. Strawberry time's up");
    expect(items[1]).toHaveTextContent("Time's up");
  });

  it("calls onPlayAgain", async () => {
    const onPlayAgain = vi.fn();
    render(<FinalScore puzzles={puzzles} score={score} onPlayAgain={onPlayAgain} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Play again" }));
    expect(onPlayAgain).toHaveBeenCalledOnce();
  });
});

describe("Beat the AI on the final screen (#66)", () => {
  const rounds = [result({ puzzleId: "p1" }), result({ puzzleId: "p2" })];
  const puzzles = [{ id: "p1", answer: "Fig" }, { id: "p2", answer: "Kiwi" }];

  it("says how many images you beat the AI on", () => {
    render(<FinalScore puzzles={puzzles} score={{ rounds, total: 200 }} beatAi={{ beaten: 1, played: 2 }} />);
    expect(screen.getByText("You beat the AI on 1 of 2.")).toBeInTheDocument();
  });

  it("counts only the images the AI played, and says so", () => {
    expect(beatAiText({ beaten: 1, played: 1 }, 2)).toBe("You beat the AI on 1 of the 1 images it played.");
    expect(beatAiText({ beaten: 0, played: 5 }, 5)).toBe("You beat the AI on 0 of 5.");
  });

  it("says nothing about the AI when it has no results, or none were sent", () => {
    expect(beatAiText({ beaten: 0, played: 0 }, 2)).toBeNull();
    const { unmount } = render(<FinalScore puzzles={puzzles} score={{ rounds, total: 200 }} beatAi={{ beaten: 0, played: 0 }} />);
    expect(screen.queryByText(/the AI/)).not.toBeInTheDocument();
    unmount();
    render(<FinalScore puzzles={puzzles} score={{ rounds, total: 200 }} />);
    expect(screen.queryByText(/the AI/)).not.toBeInTheDocument();
  });
});
