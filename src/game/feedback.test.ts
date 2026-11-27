import { describe, expect, it } from "vitest";
import { TIMED_SCORING_CONFIG } from "./scoring-config.ts";
import {
  correctStreak,
  countUpValue,
  RATINGS,
  scoreRating,
  SPEED_TIERS,
  speedLabel,
  speedTier,
} from "./feedback.ts";

// Spec for the timed-round celebrations (#283). Thresholds come from the
// tables and the config, so tuning them doesn't break these tests.

const config = TIMED_SCORING_CONFIG;
const share = (tier: string) => SPEED_TIERS.find((t) => t.tier === tier)!.share;

describe("speedTier", () => {
  it("calls a guess within the lightning share of the reveal time lightning", () => {
    expect(speedTier(0, config)).toBe("lightning");
    expect(speedTier(config.revealSeconds * share("lightning"), config)).toBe("lightning");
  });

  it("calls a slower guess within the quick share quick", () => {
    expect(speedTier(config.revealSeconds * share("lightning") + 0.01, config)).toBe("quick");
    expect(speedTier(config.revealSeconds * share("quick"), config)).toBe("quick");
  });

  it("gives no badge after that", () => {
    expect(speedTier(config.revealSeconds * share("quick") + 0.01, config)).toBeNull();
    expect(speedTier(config.limitSeconds, config)).toBeNull();
  });

  it("has a label for every tier", () => {
    expect(speedLabel("lightning")).toBe("Lightning fast!");
    expect(speedLabel("quick")).toBe("Quick eye!");
  });
});

describe("correctStreak", () => {
  it("counts the correct rounds at the end", () => {
    expect(correctStreak(["timedOut", "correct", "correct"])).toBe(2);
  });

  it("is 0 when the last round timed out, or nothing was played", () => {
    expect(correctStreak(["correct", "timedOut"])).toBe(0);
    expect(correctStreak([])).toBe(0);
  });
});

describe("scoreRating", () => {
  it("rates by the share of the most possible points, highest band first", () => {
    for (const { atLeast, label } of RATINGS) {
      if (atLeast > 0 && atLeast < 1) expect(scoreRating(atLeast * 1000, 1000)).toBe(label);
    }
    expect(scoreRating(1000, 1000)).toBe(RATINGS[0]!.label);
  });

  it("encourages any score above 0, and says so kindly at 0", () => {
    expect(scoreRating(1, 30_000)).toBe("You got on the board.");
    expect(scoreRating(0, 30_000)).toBe("Tough set. Try again tomorrow.");
    expect(scoreRating(0, 0)).toBe("Tough set. Try again tomorrow.");
  });
});

describe("countUpValue", () => {
  it("starts at 0 and ends exactly on the target", () => {
    expect(countUpValue(8_575, 0, 900)).toBe(0);
    expect(countUpValue(8_575, 900, 900)).toBe(8_575);
    expect(countUpValue(8_575, 5_000, 900)).toBe(8_575);
  });

  it("is past halfway at the halfway point (it eases out)", () => {
    expect(countUpValue(1_000, 450, 900)).toBeGreaterThan(500);
  });

  it("only ever goes up", () => {
    let last = -1;
    for (let ms = 0; ms <= 900; ms += 30) {
      const value = countUpValue(1_000, ms, 900);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("shows the target at once with no duration", () => {
    expect(countUpValue(42, 0, 0)).toBe(42);
  });
});
