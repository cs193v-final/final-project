import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoundResult, ScoringConfig } from "@/game/types";
import { RoundValue, ScoreHeader } from "./LiveScore";

// Fixed values so these don't change when playtesting tweaks SCORING_CONFIG.
const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };

const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, "");
const playing = (revealLevel: number, wrongGuesses = 0) =>
  ({ state: "playing", revealLevel, maxRevealLevel: 3, wrongGuesses }) as const;

describe("ScoreHeader", () => {
  it("shows the image number and the running total", () => {
    expect(text(<ScoreHeader index={1} count={3} total={150} />)).toBe("Image 2 of 3Score 150");
  });
});

describe("RoundValue while playing", () => {
  it("shows what the image is worth now and after a zoom-out", () => {
    expect(text(<RoundValue round={playing(0)} config={CONFIG} />)).toBe("Worth 100 points now · 80 if you zoom out");
  });

  it("includes wrong-guess penalties", () => {
    expect(text(<RoundValue round={playing(1, 2)} config={CONFIG} />)).toBe("Worth 60 points now · 40 if you zoom out");
  });

  it("drops the zoom hint at the full image", () => {
    expect(text(<RoundValue round={playing(3)} config={CONFIG} />)).toBe("Worth 40 points now");
  });

  it("drops the zoom hint when the floor means zooming costs nothing", () => {
    expect(text(<RoundValue round={playing(2, 9)} config={CONFIG} />)).toBe("Worth 10 points now");
  });
});

describe("RoundValue after the round", () => {
  const result = (points: number): RoundResult => ({
    puzzleId: "p1",
    outcome: points > 0 ? "correct" : "skipped",
    revealLevelReached: 1,
    wrongGuesses: 0,
    points,
    breakdown: { base: 100, revealPenalty: 20, wrongGuessPenalty: 0 },
  });

  it("shows what the image earned", () => {
    expect(text(<RoundValue round={{ ...playing(1), state: "correct" }} result={result(80)} />)).toBe(
      "+80 points for this image",
    );
  });

  it("shows zero for a skip", () => {
    expect(text(<RoundValue round={{ ...playing(1), state: "skipped" }} result={result(0)} />)).toBe(
      "+0 points for this image",
    );
  });
});
