// @vitest-environment jsdom
// Spec for the Beat the AI badge on the round screen (#66).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiBadge } from "./AiBadge";

const playing = (aiSolvedLevel: number | null) => ({ state: "playing" as const, aiSolvedLevel, levelCount: 5 });
const over = (aiSolvedLevel: number | null) => ({ state: "correct" as const, aiSolvedLevel, levelCount: 5 });

describe("AiBadge", () => {
  it("names the zoom level the AI got the image at, as a target, while playing", () => {
    render(<AiBadge round={playing(2)} />);
    expect(screen.getByText("The AI got this at zoom level 3 of 5. Can you beat it?")).toBeInTheDocument();
  });

  it("says how you did once the round is over, in words", () => {
    const cases: [number, "correct" | "skipped", string][] = [
      [1, "correct", "You beat the AI! It needed zoom level 3."],
      [2, "correct", "A tie: the AI got it at zoom level 3 too."],
      [4, "correct", "The AI got this one first, at zoom level 3."],
      [0, "skipped", "The AI got it at zoom level 3."],
    ];
    for (const [revealLevelReached, outcome, text] of cases) {
      const { unmount } = render(<AiBadge round={over(2)} result={{ outcome, revealLevelReached }} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows nothing when the AI has no result for the image", () => {
    const { container } = render(<AiBadge round={playing(null)} />);
    expect(container).toBeEmptyDOMElement();
    render(<AiBadge round={over(null)} result={{ outcome: "correct", revealLevelReached: 0 }} />);
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
  });
});
