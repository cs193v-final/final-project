// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import { TimedFinalScore, timedRoundText, type TimedRoundSummary } from "./TimedFinalScore";

const rounds: TimedRoundSummary[] = [
  { answer: "Giraffe", outcome: "correct", seconds: 4.27, points: 6_000 },
  { answer: "Strawberry", outcome: "timedOut", seconds: 30, points: 0 },
  { answer: "Golden Gate Bridge", outcome: "correct", seconds: 12.5, points: 2_575 },
];

describe("timedRoundText", () => {
  it("gives the time of a correct guess, rounded down to a tenth", () => {
    expect(timedRoundText(rounds[0]!)).toBe("Got it in 4.2 s");
  });

  it("says Time's up for a time-out", () => {
    expect(timedRoundText(rounds[1]!)).toBe("Time's up");
  });
});

describe("TimedFinalScore", () => {
  it("shows the total out of the most possible", () => {
    render(<TimedFinalScore rounds={rounds} scoring={TIMED_SCORING_CONFIG} />);
    const max = TIMED_SCORING_CONFIG.maxPoints * rounds.length;
    expect(screen.getByText(/You scored/u)).toHaveTextContent(`You scored 8,575 out of ${max.toLocaleString("en-US")}`);
  });

  it("says how many were guessed and the fastest time", () => {
    render(<TimedFinalScore rounds={rounds} scoring={TIMED_SCORING_CONFIG} />);
    expect(screen.getByText("2 of 3 guessed, fastest in 4.2 s")).toBeInTheDocument();
  });

  it("leaves out the fastest time when nothing was guessed", () => {
    render(<TimedFinalScore rounds={[rounds[1]!]} scoring={TIMED_SCORING_CONFIG} />);
    expect(screen.getByText("0 of 1 guessed")).toBeInTheDocument();
  });

  it("lists each photo in order with its time and points", () => {
    render(<TimedFinalScore rounds={rounds} scoring={TIMED_SCORING_CONFIG} />);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "1. GiraffeGot it in 4.2 s6,000",
      "2. StrawberryTime's up0",
      "3. Golden Gate BridgeGot it in 12.5 s2,575",
    ]);
  });

  it("moves focus to the heading", () => {
    render(<TimedFinalScore rounds={rounds} scoring={TIMED_SCORING_CONFIG} title="Daily complete" />);
    expect(screen.getByRole("heading", { name: "Daily complete" })).toHaveFocus();
  });

  it("shows how the player did against the AI when given", () => {
    render(<TimedFinalScore rounds={rounds} scoring={TIMED_SCORING_CONFIG} beatAi={{ beaten: 2, played: 3 }} />);
    expect(screen.getByText("You beat the AI on 2 of 3.")).toBeInTheDocument();
  });

  it("offers Play again only when it can be replayed", () => {
    const onPlayAgain = vi.fn();
    const { rerender } = render(<TimedFinalScore rounds={rounds} scoring={TIMED_SCORING_CONFIG} />);
    expect(screen.queryByRole("button", { name: "Play again" })).not.toBeInTheDocument();
    rerender(<TimedFinalScore rounds={rounds} scoring={TIMED_SCORING_CONFIG} onPlayAgain={onPlayAgain} />);
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(onPlayAgain).toHaveBeenCalledOnce();
  });
});
