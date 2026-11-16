import { describe, expect, it } from "vitest";

import { SCORING_CONFIG } from "./scoring-config.ts";
import { parseScoringOverride, resolveScoringConfig, ScoringConfigError } from "./scoring-override.ts";
import type { ScoringConfig } from "./types.ts";

const FULL: ScoringConfig = { basePoints: 200, revealPenalty: 30, wrongGuessPenalty: 15, minPoints: 20, skipPoints: 5 };

describe("resolveScoringConfig", () => {
  it("uses the default when there is no override", () => {
    expect(resolveScoringConfig(null)).toEqual(SCORING_CONFIG);
    expect(resolveScoringConfig(undefined)).toEqual(SCORING_CONFIG);
  });

  it("returns a copy, so callers can't change the default by accident", () => {
    expect(resolveScoringConfig(null)).not.toBe(SCORING_CONFIG);
  });

  it("uses a full valid override as is", () => {
    expect(resolveScoringConfig(FULL)).toEqual(FULL);
  });

  it("merges a partial override over the default", () => {
    expect(resolveScoringConfig({ basePoints: 150 })).toEqual({ ...SCORING_CONFIG, basePoints: 150 });
    expect(resolveScoringConfig({})).toEqual(SCORING_CONFIG);
  });

  it("merges over a different base when given one", () => {
    expect(resolveScoringConfig({ skipPoints: 0 }, FULL)).toEqual({ ...FULL, skipPoints: 0 });
  });

  it.each([
    ["a string", "100"],
    ["a number", 100],
    ["an array", [100]],
    ["an unknown field (typo)", { basepoints: 150 }],
    ["a string value", { basePoints: "150" }],
    ["a null value", { basePoints: null }],
    ["a negative value", { revealPenalty: -5 }],
    ["a non-finite value", { basePoints: Infinity }],
  ])("rejects %s", (_, stored) => {
    expect(() => resolveScoringConfig(stored)).toThrow(ScoringConfigError);
  });

  it("validates the merged result, not just the fields given", () => {
    // minPoints 10 from the default would be above basePoints 5.
    expect(() => resolveScoringConfig({ basePoints: 5 })).toThrow(/minPoints can't be more than basePoints/);
    // skipPoints 50 is fine on its own but beats the default floor of 10.
    expect(() => resolveScoringConfig({ skipPoints: 50 })).toThrow(/skipPoints can't be more than minPoints/);
    expect(() => resolveScoringConfig({ basePoints: 5 })).toThrow(ScoringConfigError);
  });

  it("names the bad field in the error", () => {
    expect(() => resolveScoringConfig({ wrongGuessPenalty: "x" })).toThrow(/wrongGuessPenalty/);
    expect(() => resolveScoringConfig({ bonus: 1 })).toThrow(/unknown field "bonus"/);
  });
});

describe("parseScoringOverride", () => {
  it("returns null for no override and the given fields otherwise", () => {
    expect(parseScoringOverride(null)).toBeNull();
    expect(parseScoringOverride({ basePoints: 150 })).toEqual({ basePoints: 150 });
  });

  it("throws for the same inputs resolveScoringConfig rejects", () => {
    expect(() => parseScoringOverride({ basePoints: 5 })).toThrow(ScoringConfigError);
  });
});
