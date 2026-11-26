import { describe, expect, it } from "vitest";
import {
  MAX_SCORING_VALUE,
  MAX_TIMED_CURVE,
  MAX_TIMED_LIMIT_SECONDS,
  scoreAt,
  validateTimedScoringConfig,
} from "./scoring.ts";
import { TIMED_SCORING_CONFIG } from "./scoring-config.ts";
import type { TimedScoringConfig } from "./types.ts";

// Fixed numbers so these tests don't change when playtesting tweaks TIMED_SCORING_CONFIG.
const CONFIG: TimedScoringConfig = {
  maxPoints: 10_000,
  minPoints: 100,
  revealSeconds: 25,
  limitSeconds: 30,
  curve: 2,
};

describe("scoreAt: the draining score (timed-reveal redesign, #256)", () => {
  it("gives maxPoints for a guess at 0 s", () => {
    expect(scoreAt(0, CONFIG)).toBe(10_000);
  });

  it("drains along the curve: 100 + 9,900 × (1 − t / 25)²", () => {
    expect(scoreAt(12.5, CONFIG)).toBe(2_575); // 100 + 9,900 × 0.25
    expect(scoreAt(5, CONFIG)).toBe(6_436); // 100 + 9,900 × 0.64
    expect(scoreAt(20, CONFIG)).toBe(496); // 100 + 9,900 × 0.04
  });

  it("drains faster early on than late", () => {
    const firstFive = scoreAt(0, CONFIG) - scoreAt(5, CONFIG);
    const lastFive = scoreAt(20, CONFIG) - scoreAt(25, CONFIG);
    expect(firstFive).toBeGreaterThan(lastFive);
  });

  it("never goes up as time passes", () => {
    let previous = Infinity;
    for (let tenths = 0; tenths <= 300; tenths++) {
      const points = scoreAt(tenths / 10, CONFIG);
      expect(points).toBeLessThanOrEqual(previous);
      previous = points;
    }
  });

  it("gives minPoints once the photo is clear, and from then until the limit", () => {
    expect(scoreAt(25, CONFIG)).toBe(100);
    expect(scoreAt(27.5, CONFIG)).toBe(100);
    expect(scoreAt(29.999, CONFIG)).toBe(100);
  });

  it("gives 0 at the limit and after it (time's up)", () => {
    expect(scoreAt(30, CONFIG)).toBe(0);
    expect(scoreAt(45, CONFIG)).toBe(0);
  });

  it("always returns a whole number (points go into integer columns)", () => {
    for (const t of [0.1, 1.234, 7.77, 19.01]) expect(Number.isInteger(scoreAt(t, CONFIG))).toBe(true);
  });

  it("counts a negative time as 0, so a clock slightly behind doesn't throw", () => {
    expect(scoreAt(-0.2, CONFIG)).toBe(10_000);
  });

  it.each([NaN, Infinity, -Infinity])("throws on the time %s", (seconds) => {
    expect(() => scoreAt(seconds, CONFIG)).toThrow(/seconds/);
  });

  it("drains evenly with curve 1", () => {
    expect(scoreAt(12.5, { ...CONFIG, curve: 1 })).toBe(5_050);
  });

  it("uses TIMED_SCORING_CONFIG by default", () => {
    expect(scoreAt(0)).toBe(TIMED_SCORING_CONFIG.maxPoints);
    expect(scoreAt(TIMED_SCORING_CONFIG.limitSeconds)).toBe(0);
  });

  it("throws on an invalid config", () => {
    expect(() => scoreAt(0, { ...CONFIG, curve: 0 })).toThrow(/curve/);
  });
});

describe("validateTimedScoringConfig", () => {
  it("accepts the default config", () => {
    expect(() => validateTimedScoringConfig(TIMED_SCORING_CONFIG)).not.toThrow();
  });

  it.each([-1, 1.5, NaN, MAX_SCORING_VALUE + 1])("rejects maxPoints %s", (maxPoints) => {
    expect(() => validateTimedScoringConfig({ ...CONFIG, maxPoints })).toThrow(/maxPoints/);
  });

  it.each([-1, 0.5, NaN])("rejects minPoints %s", (minPoints) => {
    expect(() => validateTimedScoringConfig({ ...CONFIG, minPoints })).toThrow(/minPoints/);
  });

  it("rejects minPoints above maxPoints, and allows them equal (a flat score)", () => {
    expect(() => validateTimedScoringConfig({ ...CONFIG, minPoints: 10_001 })).toThrow(/minPoints/);
    expect(() => validateTimedScoringConfig({ ...CONFIG, minPoints: 10_000 })).not.toThrow();
  });

  it.each([0, -5, NaN, Infinity])("rejects revealSeconds %s", (revealSeconds) => {
    expect(() => validateTimedScoringConfig({ ...CONFIG, revealSeconds })).toThrow(/revealSeconds/);
  });

  it("rejects a limit before the photo is clear, or past the cap", () => {
    expect(() => validateTimedScoringConfig({ ...CONFIG, limitSeconds: 24 })).toThrow(/limitSeconds/);
    expect(() => validateTimedScoringConfig({ ...CONFIG, limitSeconds: MAX_TIMED_LIMIT_SECONDS + 1 })).toThrow(
      /limitSeconds/,
    );
    expect(() => validateTimedScoringConfig({ ...CONFIG, limitSeconds: NaN })).toThrow(/limitSeconds/);
  });

  it("allows the limit to equal the clear time (no grace period)", () => {
    const config = { ...CONFIG, limitSeconds: 25 };
    expect(() => validateTimedScoringConfig(config)).not.toThrow();
    expect(scoreAt(24.9, config)).toBe(100);
    expect(scoreAt(25, config)).toBe(0);
  });

  it.each([0, -1, NaN, MAX_TIMED_CURVE + 0.1])("rejects curve %s", (curve) => {
    expect(() => validateTimedScoringConfig({ ...CONFIG, curve })).toThrow(/curve/);
  });
});
