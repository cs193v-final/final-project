"use server";

// Server Actions for the dev-only /dev/round preview (#256). Like every Server
// Action they're public POST endpoints, so they refuse in production builds
// and treat every argument as untrusted. They only read the practice pack
// (public in the repo) and write nothing.

import { checkGuess } from "@/game/guess";
import { parsePuzzles } from "@/game/puzzles";
import samplePuzzles from "@/puzzles/sample.json";

const MAX_GUESS_LENGTH = 200;

function puzzleAt(index: unknown) {
  if (process.env.NODE_ENV === "production") throw new Error("Not available");
  const puzzles = parsePuzzles(samplePuzzles);
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= puzzles.length) {
    throw new Error("No such preview image");
  }
  return puzzles[index]!;
}

/** Check a guess for preview image `index`: right, wrong (with the normalized guess), or blank. */
export async function checkPreviewGuess(
  index: number,
  guess: string,
): Promise<{ kind: "correct" } | { kind: "incorrect"; normalizedGuess: string } | { kind: "empty" }> {
  const puzzle = puzzleAt(index);
  if (typeof guess !== "string" || guess.length > MAX_GUESS_LENGTH) return { kind: "empty" };
  const outcome = checkGuess(puzzle, guess);
  return outcome.kind === "correct" ? { kind: "correct" } : outcome;
}

/** The answer for preview image `index`, for the end of its round. */
export async function previewAnswer(index: number): Promise<string> {
  return puzzleAt(index).answer;
}
