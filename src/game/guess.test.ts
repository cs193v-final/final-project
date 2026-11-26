import { describe, expect, it } from "vitest";
import {
  allowedTypos,
  checkGuess,
  exactMatch,
  normalizeGuess,
  typoCount,
  typoDistance,
  type AnswerMatcher,
} from "./guess.ts";

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

  it("removes invisible characters, so a guess that looks right is right", () => {
    // Zero-width space, soft hyphen, zero-width (non-)joiner, word joiner,
    // left-to-right and right-to-left marks: NFKC keeps them all.
    for (const invisible of ["\u200B", "\u00AD", "\u200C", "\u200D", "\u2060", "\u200E", "\u200F"]) {
      expect(normalizeGuess(`Ov${invisible}al`)).toBe("oval");
      expect(normalizeGuess(`${invisible}Oval${invisible}`)).toBe("oval");
      expect(checkGuess({ answer: "Oval", acceptedAnswers: [] }, `Ov${invisible}al`)).toEqual({
        kind: "correct",
        matched: "Oval",
      });
    }
    expect(normalizeGuess("Big\u200B Ben")).toBe("big ben");
    expect(normalizeGuess("\u200B")).toBe("");
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

  it("removes . ' \" and turns , ! ? into word breaks", () => {
    expect(normalizeGuess("St. Paul's Cathedral")).toBe("st pauls cathedral");
    expect(normalizeGuess("Golden Gate Bridge.")).toBe("golden gate bridge");
    expect(normalizeGuess("Hello, world!?")).toBe("hello world");
    expect(normalizeGuess("Washington, D.C.")).toBe("washington dc");
    expect(normalizeGuess("Paris,France")).toBe("paris france");
    expect(normalizeGuess("Wow!Bridge?Yes")).toBe("wow bridge yes");
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
      // A missing space is a word break, not punctuation. Typo tolerance (#115)
      // forgives a missing or extra space when the letters are otherwise exact.
      expect(checkGuess(notreDame, "NotreDame", { matcher: exactMatch }).kind).toBe("incorrect");
      expect(checkGuess(notreDame, "NotreDame").kind).toBe("correct");
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

describe("typo tolerance (#21, #115)", () => {
  const hoover = { answer: "Hoover Tower", acceptedAnswers: [] };
  const oval = { answer: "The Oval", acceptedAnswers: ["Oval"] };
  const only = (answer: string) => ({ answer, acceptedAnswers: [] });

  it.each([
    ["oval", 0],
    ["quad", 0],
    ["paris", 1],
    ["stanford", 1],
    ["lagunita", 1],
    ["cathedral", 2],
  ])("allows %j %i typos (none under 5 letters, 1 from 5, 2 from 9)", (word, typos) => {
    expect(allowedTypos(word)).toBe(typos);
  });

  it.each([
    ["hoover tower", "hoover tower", 0],
    ["hover tower", "hoover tower", 1], // missing letter
    ["hooover tower", "hoover tower", 1], // extra letter
    ["hoovar tower", "hoover tower", 1], // wrong letter
    ["hoover towre", "hoover tower", 1], // swapped letters
    ["hovr towr", "hoover tower", 3],
  ])("counts %j -> %j as %i typos", (a, b, typos) => {
    expect(typoDistance(a, b)).toBe(typos);
  });

  it("stops counting early past the limit", () => {
    expect(typoDistance("abc", "xyzxyz", 1)).toBe(2);
  });

  // Each row of the #140 review, plus the cases the rule is meant to cover.
  it.each([
    // [answer, alternates, guess, matched answer or null for incorrect]
    ["Main Quad", [], "Main Quid", null], // "quad" is 4 letters: no typos, however long the answer
    ["The Oval", ["Oval"], "The Opal", null],
    ["The Oval", ["Oval"], "Opal", null],
    ["Lake Lagunita", [], "Lake Magunita", null], // each word's first letter must match
    ["Stanford Hall", [], "Stanford Mall", null],
    ["Élysée Palace", [], "Elysée Palace", "Élysée Palace"], // accented first letter
    ["Élysée Palace", [], "Elysee Palace", "Élysée Palace"],
    ["Eiffel Tower", [], "Eifel Tower", "Eiffel Tower"],
    ["Hoover Tower", [], "Hover Tower", "Hoover Tower"],
    ["Hoover Tower", [], "hovver towre", "Hoover Tower"], // one typo in each word
    ["Hoover Tower", [], "hovr towr", null],
    ["Hoover Tower", [], "Tower", null], // a word missing
    ["Golden Gate Bridge", [], "Golden Gate Bridge SF", null], // a word extra
    ["Café Borrone", [], "cafe borrone", "Café Borrone"], // an accent costs nothing, even in a 4-letter word
    ["Paris", [], "Pairs", "Paris"],
    ["Paris", [], "Parsi s", null],
    ["Oval", [], "Opal", null],
    ["Quad", [], "Quid", null],
    ["Mesa", [], "Pesa", null],
    ["Lagunita", [], "Magunita", null],
    ["Building 10", [], "Building 11", null], // digits must match
    ["Gates 104", [], "Gates 140", null],
    ["Building 10", [], "Buildng 10", "Building 10"],
    ["Notre-Dame", [], "NotreDame", "Notre-Dame"], // a missing space alone is forgiven
    ["Main Quad", [], "MainQuad", "Main Quad"],
    ["Hoover Tower", [], "Hoovertower", "Hoover Tower"],
    ["Stanford Hall", [], "StanfordMall", null], // but not a missing space and a typo
    ["Stanford Hall", [], "Stan ford Hall", "Stanford Hall"], // an extra space alone is forgiven too
    ["Stanford Hall", [], "Stan ford Mall", null],
    // Second review of #140: a moved space, letters NFD can't strip, a swapped first letter.
    ["Hoover Tower", [], "Hoove rtower", "Hoover Tower"],
    ["Stanford Hall", [], "Stan fordhall", "Stanford Hall"],
    ["Stanford Hall", [], "Stanfor dmall", null], // a moved space and a typo
    ["Øresund Bridge", [], "Oresund Bridge", "Øresund Bridge"],
    ["Łódź", [], "Lodz", "Łódź"],
    ["Straße", [], "Strasse", "Straße"],
    ["Paris", [], "aPris", "Paris"],
    ["Hoover Tower", [], "oHover Tower", "Hoover Tower"],
    ["Oval", [], "vOal", null], // still one typo, and short words allow none
    ["Paris", [], "aPirs", null], // a swapped start plus another typo is 2, over the 1 allowed
  ] as const)("for %j (alternates %j), %j is %j", (answer, alternates, guess, matched) => {
    const outcome = checkGuess({ answer, acceptedAnswers: [...alternates] }, guess);
    expect(outcome).toEqual(matched === null ? { kind: "incorrect", normalizedGuess: normalizeGuess(guess) } : { kind: "correct", matched });
  });

  it.each([
    ["hover tower", "hoover tower", 1],
    ["hovver towre", "hoover tower", 2],
    ["elysee palace", "élysée palace", 0],
    ["notredame", "notre dame", 0],
    ["main quid", "main quad", undefined],
    ["stanfordmall", "stanford hall", undefined],
  ])("typoCount(%j, %j) is %j", (guess, answer, count) => {
    expect(typoCount(guess, answer)).toBe(count);
  });

  it.each([
    // [answer, alternates, guess, matched]
    ["Hoover Tower", ["Hoover Towers"], "Hooover Towers", "Hoover Towers"], // 1 typo from the alternate, 2 from the answer
    ["Hoover Tower", ["Hoover Towar"], "Hoover Towor", "Hoover Tower"], // a tie goes to the canonical answer
    ["Stanford Mall", ["Stanford Hall"], "stanford hall", "Stanford Hall"], // an exact match on an alternate wins
    ["Stanford Mall", ["Stanford Hall"], "Stanford Hal", null], // "hall" is 4 letters: no typos
  ] as const)("for %j (alternates %j), %j matches the closest answer, %j", (answer, alternates, guess, matched) => {
    const outcome = checkGuess({ answer, acceptedAnswers: [...alternates] }, guess);
    expect(outcome).toEqual(matched === null ? { kind: "incorrect", normalizedGuess: normalizeGuess(guess) } : { kind: "correct", matched });
  });

  it("calls the matcher for every answer, so a stricter matcher can reject even an exact match", () => {
    const eiffel = { answer: "Eiffel Tower", acceptedAnswers: ["Tour Eiffel"] };
    const calls: string[] = [];
    const never: AnswerMatcher = (_, answer) => {
      calls.push(answer);
      return false;
    };
    expect(checkGuess(eiffel, "Eiffel Tower", { matcher: never }).kind).toBe("incorrect");
    expect(calls).toEqual(["eiffel tower", "tour eiffel"]);
  });

  it("prefers an exact match only among answers the matcher accepts", () => {
    const close = { answer: "Stanford Mall", acceptedAnswers: ["Stanford Hall"] };
    const notHall: AnswerMatcher = (guess, answer) => answer !== "stanford hall" && typoDistance(guess, answer) <= 1;
    expect(checkGuess(close, "stanford hall", { matcher: notHall })).toEqual({ kind: "correct", matched: "Stanford Mall" });
  });

  it("forgives nothing in short answers, and still accepts an exact alternate", () => {
    expect(checkGuess(oval, "Oval")).toEqual({ kind: "correct", matched: "Oval" });
  });

  it("can be turned off with exactMatch, which also keeps accents", () => {
    expect(checkGuess(hoover, "Hover Tower", { matcher: exactMatch }).kind).toBe("incorrect");
    expect(checkGuess(only("Élysée Palace"), "Elysee Palace", { matcher: exactMatch }).kind).toBe("incorrect");
  });
});
