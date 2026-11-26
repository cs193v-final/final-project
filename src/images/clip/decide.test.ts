// Spec for the decisions made from CLIP's scores (#56). Pure: no model.
import { describe, expect, it } from "vitest";

import {
  answerProbability,
  dot,
  firstSolvedLevel,
  focusGrid,
  isAnswer,
  isRecognizable,
  middleLevel,
  rank,
  rejectProbability,
  rejectReasons,
  suggestStartingPoints,
  topGuess,
  type FocusResult,
  type Ranking,
} from "./decide.ts";

const giraffe = { answer: "Giraffe", acceptedAnswers: ["Giraffes"] };
/** A ranking with `label` on top. */
const top = (label: string, others = ["grass", "zebra"]): Ranking => [
  { label, probability: 0.7 },
  ...others.map((other) => ({ label: other, probability: 0.3 / others.length })),
];

describe("rank", () => {
  it("turns similarities into probabilities that add up to 1, most likely first", () => {
    const ranking = rank(["grass", "giraffe", "zebra"], [0.2, 0.3, 0.25]);
    expect(ranking.map((g) => g.label)).toEqual(["giraffe", "zebra", "grass"]);
    expect(ranking.reduce((sum, g) => sum + g.probability, 0)).toBeCloseTo(1, 10);
  });

  it("uses CLIP's scale of 100: a similarity 0.05 higher is e^5 times as likely", () => {
    const [a, b] = rank(["a", "b"], [0.3, 0.25]);
    expect(a!.probability / b!.probability).toBeCloseTo(Math.exp(5), 6);
  });

  it("keeps label order on a tie, so results don't change between runs", () => {
    expect(rank(["b", "a"], [0.1, 0.1]).map((g) => g.label)).toEqual(["b", "a"]);
  });

  it("refuses a similarity count that doesn't match the labels", () => {
    expect(() => rank(["a", "b"], [0.1])).toThrow(RangeError);
    expect(() => rank([], [])).toThrow(RangeError);
  });

  it("dot is the cosine similarity of unit vectors", () => {
    expect(dot(new Float32Array([0.6, 0.8]), new Float32Array([0.8, 0.6]))).toBeCloseTo(0.96, 6);
    expect(() => dot(new Float32Array(2), new Float32Array(3))).toThrow(RangeError);
  });
});

describe("what counts as the answer", () => {
  it("is the answer or an alternate, whatever the case or punctuation", () => {
    for (const label of ["Giraffe", "giraffe", "GIRAFFE", "giraffes", " Giraffe. "]) expect(isAnswer(giraffe, label)).toBe(true);
    expect(isAnswer({ answer: "St. Paul's", acceptedAnswers: [] }, "st pauls")).toBe(true);
    for (const label of ["zebra", "animal", ""]) expect(isAnswer(giraffe, label)).toBe(false);
  });

  it("isn't the player's typo rule: CLIP's labels are never misspelled, so a near spelling is a different word", () => {
    // Generic labels one letter off a plausible answer (#192 review). A player
    // typing them would get the point; CLIP choosing them hasn't solved it.
    const pairs = [["Tower", "towel"], ["Horse", "house"], ["Beach", "bench"], ["Moose", "mouse"], ["Chair", "chain"], ["Baseball", "basketball"]];
    for (const [answer, label] of pairs) expect(isAnswer({ answer: answer!, acceptedAnswers: [] }, label!)).toBe(false);
    expect(isAnswer(giraffe, "Girafe")).toBe(false);
  });

  it("counts a regular plural or singular of the answer, as it would for a player", () => {
    const cases = [
      ["Peanut", "peanuts"],
      ["Glass", "glasses"],
      ["Strawberry", "strawberries"],
      ["Leaf", "leaves"],
      ["Knife", "knives"],
      ["Green bean", "green beans"],
      ["French fry", "french fries"],
      ["Dumplings", "dumpling"], // the answer plural, the label singular
    ];
    for (const [answer, label] of cases) expect(isAnswer({ answer: answer!, acceptedAnswers: [] }, label!)).toBe(true);
    // Only a whole ending: these aren't plurals of each other.
    for (const [answer, label] of [["Pea", "peak"], ["Leaf", "leaves of grass"], ["Tower", "towers of london"]]) {
      expect(isAnswer({ answer: answer!, acceptedAnswers: [] }, label!)).toBe(false);
    }
  });

  it("adds up the probability of every label that counts", () => {
    const ranking: Ranking = [
      { label: "giraffe", probability: 0.5 },
      { label: "zebra", probability: 0.3 },
      { label: "giraffes", probability: 0.2 },
    ];
    expect(answerProbability(giraffe, ranking)).toBeCloseTo(0.7, 10);
    expect(topGuess(ranking).label).toBe("giraffe");
    expect(() => topGuess([])).toThrow(RangeError);
  });

  it("calls a photo recognizable only if the answer is the top guess at full view", () => {
    expect(isRecognizable(giraffe, top("giraffe"))).toBe(true);
    expect(isRecognizable(giraffe, top("zebra", ["giraffe"]))).toBe(false);
  });
});

describe("firstSolvedLevel (Beat the AI's aiSolvedLevel)", () => {
  it("is the first view whose top guess is the answer", () => {
    expect(firstSolvedLevel(giraffe, [top("fur"), top("zebra"), top("Giraffe"), top("Giraffe"), top("Giraffe")])).toBe(2);
    expect(firstSolvedLevel(giraffe, [top("giraffe"), top("zebra")])).toBe(0);
  });

  it("doesn't count a later view going wrong again: the first right one stands", () => {
    expect(firstSolvedLevel(giraffe, [top("fur"), top("giraffe"), top("zebra")])).toBe(1);
  });

  it("is null when CLIP never gets it", () => {
    expect(firstSolvedLevel(giraffe, [top("fur"), top("zebra"), top("horse")])).toBeNull();
    expect(firstSolvedLevel(giraffe, [])).toBeNull();
  });

  it("needs the top guess: the answer in second place doesn't count", () => {
    expect(firstSolvedLevel(giraffe, [top("zebra", ["giraffe"])])).toBeNull();
  });

  it("doesn't count a near spelling on top: 'towel' for a Tower isn't the AI solving it (#192 review)", () => {
    const tower = { answer: "Tower", acceptedAnswers: [] };
    expect(firstSolvedLevel(tower, [top("towel"), top("towel", ["tower"]), top("tower")])).toBe(2);
    expect(firstSolvedLevel(tower, [top("towel"), top("towel")])).toBeNull();
    expect(isRecognizable(tower, top("towel", ["tower"]))).toBe(false);
    expect(answerProbability(tower, top("towel", ["tower"]))).toBeCloseTo(0.3, 10);
  });

  it("counts a plural on top: 'peanuts' for a Peanut is", () => {
    expect(firstSolvedLevel({ answer: "Peanut", acceptedAnswers: [] }, [top("almonds"), top("peanuts")])).toBe(1);
  });
});

describe("reasons to reject", () => {
  const ranking: Ranking = [
    { label: "a photo with a watermark", probability: 0.4 },
    { label: "a photo of nature", probability: 0.35 },
    { label: "a photo with text written on it", probability: 0.25 },
  ];

  it("scores a reason as the total probability of its 'yes' sentences", () => {
    expect(rejectProbability(ranking, ["a photo with a watermark", "a photo with text written on it"])).toBeCloseTo(0.65, 10);
    expect(rejectProbability(ranking, ["a photo of a person"])).toBe(0);
  });

  it("flags each reason scored at or over the threshold", () => {
    expect(rejectReasons({ text: 0.65, people: 0.1 })).toEqual(["text"]);
    expect(rejectReasons({ text: 0.5, people: 0.9 })).toEqual(["text", "people"]);
    expect(rejectReasons({ text: 0.49, people: 0 })).toEqual([]);
    expect(rejectReasons({ text: 0.3, people: 0.3 }, 0.25)).toEqual(["text", "people"]);
  });
});

describe("focusGrid", () => {
  it("is the centres of an n × n grid, row by row", () => {
    const grid = focusGrid(5);
    expect(grid).toHaveLength(25);
    expect(grid.slice(0, 5)).toEqual([0.1, 0.3, 0.5, 0.7, 0.9].map((x) => ({ x, y: 0.1 })));
    expect(grid[24]).toEqual({ x: 0.9, y: 0.9 });
    expect(focusGrid(1)).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(() => focusGrid(0)).toThrow(RangeError);
    expect(() => focusGrid(2.5)).toThrow(RangeError);
  });
});

describe("suggestStartingPoints", () => {
  const point = (x: number, y: number, solvedLevel: number | null, openingAnswerProbability = 0): FocusResult => ({
    focus: { x, y },
    solvedLevel,
    openingAnswerProbability,
  });

  it("takes the middle view of five as view 2, and of four as view 1", () => {
    expect(middleLevel(5)).toBe(2);
    expect(middleLevel(4)).toBe(1);
    expect(middleLevel(1)).toBe(0);
  });

  it("offers points CLIP fails at the first view but solves by the middle one", () => {
    const results = [point(0.1, 0.1, 0), point(0.5, 0.1, 1), point(0.9, 0.1, 2), point(0.1, 0.9, 3), point(0.9, 0.9, null)];
    expect(suggestStartingPoints(results, 5).map((r) => r.solvedLevel)).toEqual([1, 2]);
  });

  it("puts the most ambiguous first view first, and returns at most three", () => {
    const results = [point(0.1, 0.1, 1, 0.3), point(0.9, 0.1, 2, 0.01), point(0.1, 0.9, 1, 0.2), point(0.9, 0.9, 2, 0.1)];
    expect(suggestStartingPoints(results, 5).map((r) => r.openingAnswerProbability)).toEqual([0.01, 0.1, 0.2]);
  });

  it("skips a point too close to one already suggested, so it isn't three neighbours", () => {
    const results = [point(0.5, 0.5, 1, 0), point(0.5, 0.6, 1, 0.01), point(0.5, 0.9, 1, 0.02)];
    expect(suggestStartingPoints(results, 5).map((r) => r.focus)).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 0.9 },
    ]);
    expect(suggestStartingPoints(results, 5, { minDistance: 0 })).toHaveLength(3);
  });

  it("returns fewer, or none, when fewer qualify", () => {
    expect(suggestStartingPoints([point(0.5, 0.5, 0), point(0.1, 0.1, 4)], 5)).toEqual([]);
    expect(suggestStartingPoints([point(0.5, 0.5, 1)], 5, { count: 3 })).toHaveLength(1);
  });

  it("keeps the caller's extra fields on each suggestion", () => {
    const results = [{ ...point(0.5, 0.5, 1), levels: ["kept"] }];
    expect(suggestStartingPoints(results, 5)[0]!.levels).toEqual(["kept"]);
  });
});
