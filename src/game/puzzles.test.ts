import { describe, expect, it } from "vitest";
import { EFFECTS, parsePuzzle, parsePuzzles, PuzzleDataError } from "./puzzles.ts";

function valid(): Record<string, unknown> {
  return {
    id: "giraffe",
    imageUrl: "/puzzles/giraffe.jpg",
    answer: "Giraffe",
    acceptedAnswers: ["Giraffes"],
    reveal: { focus: { x: 0.4, y: 0.66 }, zoomLevels: [8, 4, 2, 1] },
    credit: { source: "Someone, via Wikimedia Commons", license: "CC BY-SA 4.0", url: "https://example.com" },
    aiSolvedLevel: null,
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

  it("treats a missing aiSolvedLevel as not solved (null)", () => {
    expect(parsePuzzle(withField("aiSolvedLevel", undefined)).aiSolvedLevel).toBeNull();
  });

  it.each([0, 3])("accepts aiSolvedLevel %j, a level the puzzle has", (level) => {
    expect(parsePuzzle(withField("aiSolvedLevel", level)).aiSolvedLevel).toBe(level);
  });

  it.each([-1, 4, 1.5, "2"])("rejects aiSolvedLevel %j", (level) => {
    expect(errorPath(() => parsePuzzle(withField("aiSolvedLevel", level)))).toBe("puzzle.aiSolvedLevel");
  });

  // Timed-reveal redesign: each puzzle names the effect that hides it.
  it("leaves effect out when the data has none (not chosen yet)", () => {
    expect(parsePuzzle(valid())).not.toHaveProperty("effect");
  });

  it.each(EFFECTS)("accepts the effect %j", (name) => {
    expect(parsePuzzle(withField("effect", name)).effect).toBe(name);
  });

  it("offers every effect, coarse ones first", () => {
    expect(EFFECTS).toEqual(["pixelate", "spotlight", "thermal", "swirl", "zoom", "tiles", "kaleidoscope", "shards"]);
  });

  it.each(["blur", "Pixelate", "", null, 3])("rejects the effect %j, naming the allowed ones", (name) => {
    const fn = () => parsePuzzle(withField("effect", name));
    expect(errorPath(fn)).toBe("puzzle.effect");
    expect(fn).toThrow("must be one of: pixelate, spotlight, thermal, swirl, zoom, tiles");
  });

  // Beat the AI by solve time (#257): when the AI solver first got it.
  it.each([undefined, null])("leaves aiSolvedSeconds out when the data has %j (never got it, or not run yet)", (value) => {
    expect(parsePuzzle(withField("aiSolvedSeconds", value))).not.toHaveProperty("aiSolvedSeconds");
  });

  it.each([0, 6.5, 25])("accepts aiSolvedSeconds %j", (seconds) => {
    expect(parsePuzzle(withField("aiSolvedSeconds", seconds)).aiSolvedSeconds).toBe(seconds);
  });

  it.each([-0.5, Number.NaN, Number.POSITIVE_INFINITY, "6.5", true])("rejects aiSolvedSeconds %s", (seconds) => {
    const fn = () => parsePuzzle(withField("aiSolvedSeconds", seconds));
    expect(errorPath(fn)).toBe("puzzle.aiSolvedSeconds");
    expect(fn).toThrow("must be null or a number of seconds, 0 or more");
  });

  it.each(["pz-7c1e9a40", "pk_3f9c2a7e51d84b06", "a1"])("accepts the opaque id %j", (value) => {
    expect(parsePuzzle(withField("id", value)).id).toBe(value);
  });

  it("drops unknown fields", () => {
    expect(parsePuzzle({ ...valid(), extra: true })).not.toHaveProperty("extra");
  });

  it.each([
    ["id", ""],
    ["id", "Giraffe"],
    ["id", "two words"],
    ["id", "double--hyphen"],
    ["id", "-leading"],
    ["id", "trailing_"],
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
