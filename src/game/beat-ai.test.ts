// Spec for Beat the AI (#66): when a player beats the AI on an image, and the
// count for a finished game. The leaderboard (#62) counts with the same rule.
import { describe, expect, it } from "vitest";

import { aiVerdict, beatAiSummary } from "./beat-ai.ts";

const correct = (revealLevelReached: number) => ({ outcome: "correct" as const, revealLevelReached });
const skipped = (revealLevelReached: number) => ({ outcome: "skipped" as const, revealLevelReached });

describe("aiVerdict", () => {
  it("is a win when you get it right at an earlier view than the AI", () => {
    expect(aiVerdict(correct(0), 2)).toBe("beat");
    expect(aiVerdict(correct(1), 2)).toBe("beat");
  });

  it("is a tie, not a win, at the same view", () => {
    expect(aiVerdict(correct(2), 2)).toBe("tie");
    expect(aiVerdict(correct(0), 0)).toBe("tie");
  });

  it("is a loss when the AI got it at an earlier view, or you skipped", () => {
    expect(aiVerdict(correct(3), 2)).toBe("lost");
    expect(aiVerdict(skipped(0), 2)).toBe("lost");
    expect(aiVerdict(skipped(4), 4)).toBe("lost");
  });

  it("doesn't count when the AI has no result: null is 'never' but also 'not run yet'", () => {
    expect(aiVerdict(correct(0), null)).toBe("no-ai");
    expect(aiVerdict(skipped(0), null)).toBe("no-ai");
  });
});

describe("beatAiSummary", () => {
  it("counts the images beaten, of the images the AI has a result for", () => {
    const ai = new Map<string, number | null>([
      ["a", 2], // beaten
      ["b", 1], // a tie
      ["c", 0], // lost
      ["d", null], // no AI result
      ["e", 3], // beaten
    ]);
    const results = [
      { puzzleId: "a", ...correct(1) },
      { puzzleId: "b", ...correct(1) },
      { puzzleId: "c", ...skipped(2) },
      { puzzleId: "d", ...correct(0) },
      { puzzleId: "e", ...correct(0) },
    ];
    expect(beatAiSummary(results, (id) => ai.get(id) ?? null)).toEqual({ beaten: 2, played: 4 });
  });

  it("is 0 of 0 for a game with no AI results", () => {
    expect(beatAiSummary([{ puzzleId: "a", ...correct(0) }], () => null)).toEqual({ beaten: 0, played: 0 });
    expect(beatAiSummary([], () => 1)).toEqual({ beaten: 0, played: 0 });
  });
});
