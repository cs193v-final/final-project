import type { Puzzle } from "./types.ts";

/** Thrown when puzzle data doesn't match the `Puzzle` format. `path` says where. */
export class PuzzleDataError extends Error {
  constructor(
    readonly path: string,
    problem: string,
  ) {
    super(`${path}: ${problem}`);
    this.name = "PuzzleDataError";
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Json {
  if (!isObject(value)) throw new PuzzleDataError(path, "must be an object");
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PuzzleDataError(path, "must be a non-empty string");
  }
  return value;
}

function fraction(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PuzzleDataError(path, "must be a number from 0 to 1");
  }
  return value;
}

/** Lowercase letters, digits and single hyphens, so ids are safe in URLs and file names. */
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

function parseZoomLevels(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new PuzzleDataError(path, "must list at least two zoom levels");
  }
  const levels = value.map((zoom, i) => {
    if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom < 1) {
      throw new PuzzleDataError(`${path}[${i}]`, "must be a number of at least 1");
    }
    return zoom;
  });
  levels.forEach((zoom, i) => {
    const previous = levels[i - 1];
    if (previous !== undefined && zoom >= previous) {
      throw new PuzzleDataError(`${path}[${i}]`, "must be smaller than the level before it");
    }
  });
  if (levels.at(-1) !== 1) {
    throw new PuzzleDataError(path, "must end at 1 (the full image)");
  }
  return levels;
}

/** Checks one puzzle and returns it typed. Unknown extra fields are dropped. */
export function parsePuzzle(value: unknown, path = "puzzle"): Puzzle {
  const data = object(value, path);

  const id = text(data.id, `${path}.id`);
  if (!ID_PATTERN.test(id)) {
    throw new PuzzleDataError(`${path}.id`, "must be lowercase letters, digits and hyphens");
  }

  if (!Array.isArray(data.acceptedAnswers)) {
    throw new PuzzleDataError(`${path}.acceptedAnswers`, "must be an array (use [] for none)");
  }
  const acceptedAnswers = data.acceptedAnswers.map((answer, i) =>
    text(answer, `${path}.acceptedAnswers[${i}]`),
  );

  const reveal = object(data.reveal, `${path}.reveal`);
  const focus = object(reveal.focus, `${path}.reveal.focus`);
  const credit = object(data.credit, `${path}.credit`);

  return {
    id,
    imageUrl: text(data.imageUrl, `${path}.imageUrl`),
    answer: text(data.answer, `${path}.answer`),
    acceptedAnswers,
    reveal: {
      focus: {
        x: fraction(focus.x, `${path}.reveal.focus.x`),
        y: fraction(focus.y, `${path}.reveal.focus.y`),
      },
      zoomLevels: parseZoomLevels(reveal.zoomLevels, `${path}.reveal.zoomLevels`),
    },
    credit: {
      source: text(credit.source, `${path}.credit.source`),
      license: text(credit.license, `${path}.credit.license`),
      ...(credit.url === undefined ? {} : { url: text(credit.url, `${path}.credit.url`) }),
    },
  };
}

/**
 * Checks a list of puzzles (e.g. the contents of `src/puzzles/sample.json`).
 * Throws a `PuzzleDataError` naming the first bad field, so a typo in the data
 * fails loudly instead of showing a broken round.
 */
export function parsePuzzles(value: unknown): Puzzle[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PuzzleDataError("puzzles", "must be a non-empty array");
  }
  const puzzles = value.map((puzzle, i) => parsePuzzle(puzzle, `puzzles[${i}]`));
  const seen = new Set<string>();
  puzzles.forEach((puzzle, i) => {
    if (seen.has(puzzle.id)) {
      throw new PuzzleDataError(`puzzles[${i}].id`, `duplicate id "${puzzle.id}"`);
    }
    seen.add(puzzle.id);
  });
  return puzzles;
}
