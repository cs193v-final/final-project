import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoundResult, TimedScoringConfig } from "@/game/types";
import { RoundValue, ScoreHeader } from "./LiveScore";

// Fixed values so these don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const CONFIG: TimedScoringConfig = { maxPoints: 10_000, minPoints: 100, revealSeconds: 25, limitSeconds: 30, curve: 2 };

const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, "");

describe("ScoreHeader", () => {
  it("shows the image number and the running total", () => {
    expect(text(<ScoreHeader index={1} count={3} total={150} />)).toBe("Image 2 of 3Score 150");
  });
});

describe("RoundValue (timed rounds, #255)", () => {
  it("before the start, says what the image starts at and how long a round is", () => {
    expect(text(<RoundValue state="ready" seconds={0} scoring={CONFIG} />)).toBe(
      "Starts at 10,000 points and drops until you get it. 30 seconds per image.",
    );
  });

  it("while playing, shows what a correct guess is worth now and the seconds left", () => {
    expect(text(<RoundValue state="playing" seconds={0} scoring={CONFIG} />)).toBe("Worth 10,000 points now · 30 s left");
    expect(text(<RoundValue state="playing" seconds={12.5} scoring={CONFIG} />)).toBe("Worth 2,575 points now · 18 s left");
    expect(text(<RoundValue state="playing" seconds={27} scoring={CONFIG} />)).toBe("Worth 100 points now · 3 s left");
  });

  it("after the round, shows what the image earned", () => {
    const result: RoundResult = { puzzleId: "p1", outcome: "timedOut", seconds: 30, wrongGuesses: 0, points: 0 };
    expect(text(<RoundValue state="timedOut" seconds={30} scoring={CONFIG} result={result} />)).toBe("+0 points for this image");
    expect(
      text(<RoundValue state="correct" seconds={5} scoring={CONFIG} result={{ ...result, outcome: "correct", points: 6436 }} />),
    ).toBe("+6,436 points for this image");
  });
});
