import { describe, expect, it } from "vitest";

import { TIMED_SCORING_CONFIG } from "./scoring-config.ts";
import { parseScoringOverride, resolveScoringConfig, ScoringConfigError } from "./scoring-override.ts";
import type { TimedScoringConfig } from "./types.ts";

const FULL: TimedScoringConfig = { maxPoints: 5_000, minPoints: 50, revealSeconds: 20, limitSeconds: 25, curve: 1.5 };

describe("resolveScoringConfig (timed fields since #255)", () => {
  it("uses the default when there is no override", () => {
    expect(resolveScoringConfig(null)).toEqual(TIMED_SCORING_CONFIG);
    expect(resolveScoringConfig(undefined)).toEqual(TIMED_SCORING_CONFIG);
  });

  it("returns a copy, so callers can't change the default by accident", () => {
    expect(resolveScoringConfig(null)).not.toBe(TIMED_SCORING_CONFIG);
  });

  it("uses a full valid override as is", () => {
    expect(resolveScoringConfig(FULL)).toEqual(FULL);
  });

  it("merges a partial override over the default", () => {
    expect(resolveScoringConfig({ maxPoints: 12_000 })).toEqual({ ...TIMED_SCORING_CONFIG, maxPoints: 12_000 });
    expect(resolveScoringConfig({})).toEqual(TIMED_SCORING_CONFIG);
  });

  it("merges over a different base when given one", () => {
    expect(resolveScoringConfig({ curve: 3 }, FULL)).toEqual({ ...FULL, curve: 3 });
  });

  it.each([
    ["a string", "100"],
    ["a number", 100],
    ["an array", [100]],
    ["an unknown field (typo)", { maxpoints: 150 }],
    ["an old zoom-out field (from before #255)", { basePoints: 150 }],
    ["a string value", { maxPoints: "150" }],
    ["a null value", { maxPoints: null }],
    ["a negative value", { minPoints: -5 }],
    ["a non-finite value", { maxPoints: Infinity }],
    ["a zero curve", { curve: 0 }],
  ])("rejects %s", (_, stored) => {
    expect(() => resolveScoringConfig(stored)).toThrow(ScoringConfigError);
  });

  it("validates the merged result, not just the fields given", () => {
    // minPoints 100 from the default would be above maxPoints 50.
    expect(() => resolveScoringConfig({ maxPoints: 50 })).toThrow(/minPoints can't be more than maxPoints/);
    // A limit of 20 s is fine on its own but comes before the default clear time of 25 s.
    expect(() => resolveScoringConfig({ limitSeconds: 20 })).toThrow(/limitSeconds/);
    expect(() => resolveScoringConfig({ maxPoints: 50 })).toThrow(ScoringConfigError);
  });

  it("names the bad field in the error", () => {
    expect(() => resolveScoringConfig({ curve: "x" })).toThrow(/curve/);
    expect(() => resolveScoringConfig({ bonus: 1 })).toThrow(/unknown field "bonus"/);
  });

  it("rejects fractional points and values too big for the integer columns (#76 review)", () => {
    expect(() => resolveScoringConfig({ maxPoints: 12.5 })).toThrow(/maxPoints.*whole number/);
    expect(() => resolveScoringConfig({ maxPoints: 1e300 })).toThrow(/maxPoints/);
  });
});

describe("parseScoringOverride", () => {
  it("returns null for no override and the given fields otherwise", () => {
    expect(parseScoringOverride(null)).toBeNull();
    expect(parseScoringOverride({ maxPoints: 12_000 })).toEqual({ maxPoints: 12_000 });
  });

  it("throws for the same inputs resolveScoringConfig rejects", () => {
    expect(() => parseScoringOverride({ maxPoints: 50 })).toThrow(ScoringConfigError);
  });
});
