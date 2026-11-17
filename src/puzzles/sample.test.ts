import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGuess } from "../game/guess.ts";
import { findAnswerLeaks } from "../game/packs.ts";
import { PRACTICE_CONTENT, PRACTICE_PACK, SAMPLE_PUZZLES } from "./index.ts";

describe("SAMPLE_PUZZLES", () => {
  it("has the three practice puzzles", () => {
    expect(SAMPLE_PUZZLES.map((p) => p.answer)).toEqual(["Giraffe", "Strawberry", "Golden Gate Bridge"]);
  });

  it("uses opaque ids and image file names that don't give the answer away (#36)", () => {
    expect(findAnswerLeaks(PRACTICE_CONTENT)).toEqual([]);
    for (const puzzle of SAMPLE_PUZZLES) {
      expect(puzzle.id).toMatch(/^pz-[0-9a-f]{8}$/u);
      expect(puzzle.imageUrl).toBe(`/puzzles/${puzzle.id}.jpg`);
    }
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

describe("PRACTICE_PACK", () => {
  it("is the only pack in the repo, a practice pack over the sample puzzles in order (#52)", () => {
    expect(PRACTICE_CONTENT.packs).toEqual([PRACTICE_PACK]);
    expect(PRACTICE_PACK.kind).toBe("practice");
    expect(PRACTICE_PACK.puzzleIds).toEqual(SAMPLE_PUZZLES.map((p) => p.id));
    expect(PRACTICE_CONTENT.schedule).toEqual([]);
  });

  it("keeps the id #54 already uses for its packs row", () => {
    expect(PRACTICE_PACK.id).toBe("pk_3f9c2a7e51d84b06");
  });
});
