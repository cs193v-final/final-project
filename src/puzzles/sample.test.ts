import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGuess } from "../game/guess.ts";
import { SAMPLE_PUZZLES } from "./index.ts";

describe("SAMPLE_PUZZLES", () => {
  it("has the three practice puzzles", () => {
    expect(SAMPLE_PUZZLES.map((p) => p.id)).toEqual(["giraffe", "strawberry", "golden-gate-bridge"]);
  });

  it.each(SAMPLE_PUZZLES.map((p) => [p.id, p] as const))("%s: image file exists in public/", (_id, puzzle) => {
    expect(puzzle.imageUrl).toMatch(/^\/puzzles\/.+\.jpg$/u);
    expect(existsSync(join(process.cwd(), "public", puzzle.imageUrl))).toBe(true);
  });

  it.each(SAMPLE_PUZZLES.map((p) => [p.id, p] as const))("%s: records where the image came from", (_id, puzzle) => {
    expect(puzzle.credit.license).toMatch(/^(CC0|CC BY(-SA)? \d\.\d)$/u);
    expect(puzzle.credit.url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u);
  });

  it.each(SAMPLE_PUZZLES.map((p) => [p.id, p] as const))("%s: answer and alternates are accepted", (_id, puzzle) => {
    for (const answer of [puzzle.answer, ...puzzle.acceptedAnswers]) {
      expect(checkGuess(puzzle, answer.toUpperCase()).kind).toBe("correct");
    }
  });
});
