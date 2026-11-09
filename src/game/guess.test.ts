import { describe, expect, it } from "vitest";
import { checkGuess, normalizeGuess, type AnswerMatcher } from "./guess.ts";

const puzzle = {
  answer: "Golden Gate Bridge",
  acceptedAnswers: ["golden gate", "GG Bridge"],
};

describe("normalizeGuess", () => {
  it("trims, collapses inner whitespace and lowercases", () => {
    expect(normalizeGuess("  Golden   Gate\tBridge \n")).toBe("golden gate bridge");
  });

  it("treats non-breaking and full-width characters like their plain forms", () => {
    expect(normalizeGuess("Golden Gate")).toBe("golden gate");
    expect(normalizeGuess("ＧＯＬＤＥＮ")).toBe("golden");
  });

  it("makes precomposed and combining accents equal, but keeps accents", () => {
    expect(normalizeGuess("Café")).toBe(normalizeGuess("Café"));
    expect(normalizeGuess("café")).not.toBe("cafe");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeGuess("   \t\n ")).toBe("");
  });
});

describe("checkGuess", () => {
  it("accepts the canonical answer regardless of case and spacing", () => {
    expect(checkGuess(puzzle, "  golden GATE   bridge ")).toEqual({
      kind: "correct",
      matched: "Golden Gate Bridge",
    });
  });

  it("accepts an alternate answer and reports which one matched", () => {
    expect(checkGuess(puzzle, "gg bridge")).toEqual({ kind: "correct", matched: "GG Bridge" });
  });

  it("prefers the canonical answer when several answers match", () => {
    const dup = { answer: "Paris", acceptedAnswers: ["paris"] };
    expect(checkGuess(dup, "PARIS")).toEqual({ kind: "correct", matched: "Paris" });
  });

  it("returns the normalized guess for a wrong answer", () => {
    expect(checkGuess(puzzle, "  Bay   Bridge ")).toEqual({
      kind: "incorrect",
      normalizedGuess: "bay bridge",
    });
  });

  it("does not accept partial matches", () => {
    expect(checkGuess(puzzle, "golden").kind).toBe("incorrect");
    expect(checkGuess(puzzle, "golden gate bridge sf").kind).toBe("incorrect");
  });

  it("returns empty for a blank or whitespace-only guess", () => {
    expect(checkGuess(puzzle, "")).toEqual({ kind: "empty" });
    expect(checkGuess(puzzle, "  \t ")).toEqual({ kind: "empty" });
  });

  it("ignores blank accepted answers instead of matching everything", () => {
    const sloppy = { answer: "Paris", acceptedAnswers: ["", "   "] };
    const alwaysTrue: AnswerMatcher = () => true;
    expect(checkGuess(sloppy, "london", { matcher: alwaysTrue })).toEqual({
      kind: "correct",
      matched: "Paris",
    });
    expect(checkGuess(sloppy, "london").kind).toBe("incorrect");
  });

  it("uses a custom matcher when given one (typo-tolerance hook)", () => {
    const ignoreTheSuffix: AnswerMatcher = (g, a) => a.startsWith(g) && g.length >= 6;
    expect(checkGuess(puzzle, "golden gate b", { matcher: ignoreTheSuffix })).toEqual({
      kind: "correct",
      matched: "Golden Gate Bridge",
    });
  });
});
