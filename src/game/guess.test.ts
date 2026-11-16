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

  it("treats curly and other apostrophe-like characters like a straight one", () => {
    for (const apostrophe of ["'", "\u2019", "\u2018", "\u201B", "\u02BC", "`", "\u00B4", "\uFF07"]) {
      expect(normalizeGuess(`St. Paul${apostrophe}s`)).toBe("st pauls");
    }
  });

  it("treats curly double quotes like straight ones", () => {
    for (const quoted of ['"Big Ben"', "\u201CBig Ben\u201D", "\u201EBig Ben\u201F", "\uFF02Big Ben\uFF02"]) {
      expect(normalizeGuess(quoted)).toBe("big ben");
    }
  });

  it("removes common punctuation without adding a space", () => {
    expect(normalizeGuess("St. Paul's Cathedral")).toBe("st pauls cathedral");
    expect(normalizeGuess("Golden Gate Bridge.")).toBe("golden gate bridge");
    expect(normalizeGuess("Hello, world!?")).toBe("hello world");
    expect(normalizeGuess("Washington, D.C.")).toBe("washington dc");
  });

  it("turns hyphens and dashes into spaces, then collapses whitespace", () => {
    expect(normalizeGuess("Notre-Dame")).toBe("notre dame");
    expect(normalizeGuess("Notre\u2013Dame")).toBe("notre dame");
    expect(normalizeGuess("Notre\u2014Dame")).toBe("notre dame");
    expect(normalizeGuess("Notre\u2011Dame")).toBe("notre dame");
    expect(normalizeGuess("Notre - Dame")).toBe("notre dame");
    expect(normalizeGuess(" -Notre--Dame- ")).toBe("notre dame");
  });

  it("keeps accents when stripping punctuation", () => {
    expect(normalizeGuess("Sacré-Cœur")).toBe("sacré cœur");
    expect(normalizeGuess("Sacré-Cœur")).not.toBe(normalizeGuess("Sacre Coeur"));
  });

  it("returns an empty string for punctuation-only input", () => {
    expect(normalizeGuess("...")).toBe("");
    expect(normalizeGuess(" ' - \u2019 ! ? ")).toBe("");
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

  describe("punctuation (#29)", () => {
    const stPauls = { answer: "St. Paul's Cathedral", acceptedAnswers: [] };
    const notreDame = { answer: "Notre-Dame", acceptedAnswers: [] };

    it.each([
      ["St. Paul's Cathedral", "St. Paul\u2019s Cathedral"],
      ["St. Paul's Cathedral", "st pauls cathedral"],
      ["Notre-Dame", "notre dame"],
      ["Golden Gate Bridge", "Golden Gate Bridge."],
    ])("accepts %j for the guess %j", (answer, guess) => {
      expect(checkGuess({ answer, acceptedAnswers: [] }, guess)).toEqual({ kind: "correct", matched: answer });
    });

    it("treats guesses that differ only in punctuation as equal, on purpose", () => {
      for (const guess of ["St Paul's Cathedral", "St. Pauls Cathedral!", "st. paul`s cathedral?", "St Pauls, Cathedral"]) {
        expect(checkGuess(stPauls, guess).kind).toBe("correct");
      }
      expect(checkGuess(notreDame, "Notre\u2014Dame").kind).toBe("correct");
      expect(checkGuess(notreDame, "NOTRE - DAME.").kind).toBe("correct");
    });

    it("still rejects answers that differ by more than punctuation", () => {
      expect(checkGuess(notreDame, "Notre").kind).toBe("incorrect");
      expect(checkGuess(notreDame, "Dame").kind).toBe("incorrect");
      expect(checkGuess(notreDame, "NotreDame").kind).toBe("incorrect");
      expect(checkGuess(stPauls, "St. Paul's").kind).toBe("incorrect");
      expect(checkGuess(stPauls, "St. Peter's Cathedral").kind).toBe("incorrect");
      expect(checkGuess(puzzle, "Golden Gate Bridge 2").kind).toBe("incorrect");
    });

    it("reports a wrong guess with its punctuation normalized away", () => {
      expect(checkGuess(notreDame, "Sacré-C\u0153ur!")).toEqual({ kind: "incorrect", normalizedGuess: "sacré cœur" });
    });

    it("treats a punctuation-only guess like an empty one, matching nothing", () => {
      for (const guess of [".", "...", "'", "\u2019", "-", " \u2014 ", "?!", ' " , ']) {
        expect(checkGuess(notreDame, guess)).toEqual({ kind: "empty" });
      }
    });

    it("ignores punctuation-only accepted answers instead of matching everything", () => {
      const sloppy = { answer: "Paris", acceptedAnswers: ["...", " - "] };
      const alwaysTrue: AnswerMatcher = () => true;
      expect(checkGuess(sloppy, "london", { matcher: alwaysTrue })).toEqual({ kind: "correct", matched: "Paris" });
      expect(checkGuess(sloppy, "london").kind).toBe("incorrect");
    });
  });

  it("uses a custom matcher when given one (typo-tolerance hook)", () => {
    const ignoreTheSuffix: AnswerMatcher = (g, a) => a.startsWith(g) && g.length >= 6;
    expect(checkGuess(puzzle, "golden gate b", { matcher: ignoreTheSuffix })).toEqual({
      kind: "correct",
      matched: "Golden Gate Bridge",
    });
  });
});
