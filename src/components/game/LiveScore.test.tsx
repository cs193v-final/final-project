import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoundResult, ScoringConfig } from "@/game/types";
import { RoundValue, ScoreHeader, worthTone } from "./LiveScore";

// Fixed values so these don't change when playtesting tweaks SCORING_CONFIG.
const CONFIG: ScoringConfig = { basePoints: 100, revealPenalty: 20, wrongGuessPenalty: 10, minPoints: 10, skipPoints: 0 };

const text = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/<[^>]+>/g, "");
const playing = (revealLevel: number, wrongGuesses = 0) =>
  ({ state: "playing", revealLevel, maxRevealLevel: 3, wrongGuesses }) as const;

describe("ScoreHeader", () => {
  it("shows the image number and the running total", () => {
    expect(text(<ScoreHeader index={1} count={3} total={150} />)).toBe("Image 2 of 3Score 150");
  });

  it("adds a decorative tile per image without changing what it says (#183)", () => {
    const header = <ScoreHeader index={1} count={3} total={150} outcomes={["correct"]} />;
    expect(text(header)).toBe("Image 2 of 3Score 150");
    const html = renderToStaticMarkup(header);
    expect(html).toContain('aria-hidden="true"');
    expect([...html.matchAll(/data-image-pip="(\w+)"/g)].map((m) => m[1])).toEqual(["correct", "current", "next"]);
  });
});

describe("worthTone (#183)", () => {
  it("goes Meadow, then Flash, then Peach as the image loses its points", () => {
    expect(worthTone(100, CONFIG)).toBe("text-meadow");
    expect(worthTone(40, CONFIG)).toBe("text-flash");
    expect(worthTone(10, CONFIG)).toBe("text-peach");
  });
});

describe("RoundValue while playing", () => {
  // Zoom and wrong-guess costs are explained once in How to play, not on every round (#146, from user test #90).
  it("shows only what the image is worth now", () => {
    expect(text(<RoundValue round={playing(0)} config={CONFIG} />)).toBe("Worth 100 points now");
  });

  it("includes zoom-out and wrong-guess penalties", () => {
    expect(text(<RoundValue round={playing(1, 2)} config={CONFIG} />)).toBe("Worth 60 points now");
  });

  it("never goes below the floor", () => {
    expect(text(<RoundValue round={playing(2, 9)} config={CONFIG} />)).toBe("Worth 10 points now");
  });

  it("uses the server's value when given", () => {
    expect(text(<RoundValue round={playing(0)} config={CONFIG} pointsNow={70} />)).toBe("Worth 70 points now");
  });

  it("no longer previews what a zoom-out would cost", () => {
    expect(text(<RoundValue round={playing(0)} config={CONFIG} />)).not.toMatch(/zoom out/iu);
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
