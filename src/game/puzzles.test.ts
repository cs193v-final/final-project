import { describe, expect, it } from "vitest";
import { parsePuzzle, parsePuzzles, PuzzleDataError } from "./puzzles.ts";

function valid(): Record<string, unknown> {
  return {
    id: "giraffe",
    imageUrl: "/puzzles/giraffe.jpg",
    answer: "Giraffe",
    acceptedAnswers: ["Giraffes"],
    reveal: { focus: { x: 0.4, y: 0.66 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "Someone, via Wikimedia Commons", license: "CC BY-SA 4.0", url: "https://example.com" },
  };
}

/** A valid puzzle with one field replaced. `path` is dotted, e.g. "reveal.focus.x". */
function withField(path: string, value: unknown): Record<string, unknown> {
  const puzzle = valid();
  const keys = path.split(".");
  const last = keys.pop()!;
  let target = puzzle;
  for (const key of keys) target = target[key] as Record<string, unknown>;
  if (value === undefined) delete target[last];
  else target[last] = value;
  return puzzle;
}

function errorPath(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof PuzzleDataError) return error.path;
    throw error;
  }
  throw new Error("expected a PuzzleDataError");
}

describe("parsePuzzle", () => {
  it("accepts a valid puzzle and returns the same data", () => {
    expect(parsePuzzle(valid())).toEqual(valid());
  });

  it("allows a missing credit url and no accepted answers", () => {
    const puzzle = parsePuzzle(withField("credit.url", undefined));
    expect(puzzle.credit).toEqual({ source: "Someone, via Wikimedia Commons", license: "CC BY-SA 4.0" });
    expect(parsePuzzle(withField("acceptedAnswers", [])).acceptedAnswers).toEqual([]);
  });

  it("drops unknown fields", () => {
    expect(parsePuzzle({ ...valid(), extra: true })).not.toHaveProperty("extra");
  });

  it.each([
    ["id", ""],
    ["id", "Giraffe"],
    ["id", "two words"],
    ["imageUrl", undefined],
    ["answer", "   "],
    ["acceptedAnswers", "Giraffes"],
    ["credit.source", ""],
    ["credit.license", undefined],
    ["credit.url", 42],
  ])("rejects a bad %s (%j)", (field, value) => {
    expect(errorPath(() => parsePuzzle(withField(field, value)))).toMatch(new RegExp(`^puzzle\\.${field.replace(".", "\\.")}`));
  });

  it("names the bad entry in acceptedAnswers", () => {
    expect(errorPath(() => parsePuzzle(withField("acceptedAnswers", ["ok", ""])))).toBe(
      "puzzle.acceptedAnswers[1]",
    );
  });

  it.each([-0.1, 1.1, Number.NaN, "0.5"])("rejects a focus outside 0–1 (%j)", (x) => {
    expect(errorPath(() => parsePuzzle(withField("reveal.focus.x", x)))).toBe("puzzle.reveal.focus.x");
  });

  it("accepts focus at the edges", () => {
    expect(parsePuzzle(withField("reveal.focus", { x: 0, y: 1 })).reveal.focus).toEqual({ x: 0, y: 1 });
  });

  it.each([
    ["a single level", [1], "puzzle.reveal.zoomLevels"],
    ["a level below 1", [4, 0.5], "puzzle.reveal.zoomLevels[1]"],
    ["levels that don't shrink", [4, 4, 1], "puzzle.reveal.zoomLevels[1]"],
    ["levels that grow", [2, 4, 1], "puzzle.reveal.zoomLevels[1]"],
    ["no full-image level", [8, 4, 2], "puzzle.reveal.zoomLevels"],
    ["a non-number", [8, "4", 1], "puzzle.reveal.zoomLevels[1]"],
  ])("rejects zoom levels with %s", (_name, zoomLevels, path) => {
    expect(errorPath(() => parsePuzzle(withField("reveal.zoomLevels", zoomLevels)))).toBe(path);
  });

  it("rejects something that isn't an object", () => {
    expect(errorPath(() => parsePuzzle(null))).toBe("puzzle");
    expect(errorPath(() => parsePuzzle(withField("reveal", [])))).toBe("puzzle.reveal");
  });

  it("puts the path in the error message", () => {
    expect(() => parsePuzzle(withField("answer", ""))).toThrow("puzzle.answer: must be a non-empty string");
  });
});

describe("parsePuzzles", () => {
  it("accepts a list of puzzles", () => {
    const second = { ...valid(), id: "strawberry" };
    expect(parsePuzzles([valid(), second]).map((p) => p.id)).toEqual(["giraffe", "strawberry"]);
  });

  it.each([[[]], [{}], [null]])("rejects %j", (value) => {
    expect(errorPath(() => parsePuzzles(value))).toBe("puzzles");
  });

  it("names the index of a bad puzzle", () => {
    expect(errorPath(() => parsePuzzles([valid(), withField("answer", "")]))).toBe("puzzles[1].answer");
  });

  it("rejects duplicate ids", () => {
    expect(errorPath(() => parsePuzzles([valid(), valid()]))).toBe("puzzles[1].id");
  });
});
