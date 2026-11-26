import type { Puzzle, PuzzleEffect, RevealLevel } from "./types.ts";

/**
 * Every `PuzzleEffect`, in the order a picker should offer them (coarse ones,
 * for simple photos, first). The database checks against the same list.
 */
export const EFFECTS = ["pixelate", "spotlight", "thermal", "swirl", "zoom", "tiles"] as const satisfies readonly PuzzleEffect[];

// Fails to compile if `EFFECTS` misses a `PuzzleEffect`.
const allEffectsListed: PuzzleEffect extends (typeof EFFECTS)[number] ? true : never = true;
void allEffectsListed;

/** Thrown when puzzle or pack data doesn't match its format. `path` says where. */
export class PuzzleDataError extends Error {
  // A plain field, not a `readonly path` constructor parameter, so Node can run
  // this file directly (type stripping) for the seed script (#52).
  readonly path: string;

  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = "PuzzleDataError";
    this.path = path;
  }
}

export type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function object(value: unknown, path: string): Json {
  if (!isObject(value)) throw new PuzzleDataError(path, "must be an object");
  return value;
}

export function text(value: unknown, path: string): string {
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

/**
 * Lowercase letters and digits, separated by single hyphens or underscores, so
 * ids are safe in URLs and file names ("pz-7c1e9a40", "pk_3f9c2a7e51d84b06").
 */
const ID_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/u;

/** Checks an id for a puzzle or a pack. */
export function id(value: unknown, path: string): string {
  const checked = text(value, path);
  if (!ID_PATTERN.test(checked)) {
    throw new PuzzleDataError(path, "must be lowercase letters and digits, separated by - or _");
  }
  return checked;
}

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

/** Optional in the data; missing means the AI solver (#56) hasn't solved it. */
function aiSolvedLevel(value: unknown, levelCount: number, path: string): RevealLevel | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= levelCount) {
    throw new PuzzleDataError(path, `must be null or a reveal level from 0 to ${levelCount - 1}`);
  }
  return value;
}

/** Optional in the data; missing means no effect has been chosen yet. */
function effect(value: unknown, path: string): PuzzleEffect | undefined {
  if (value === undefined) return undefined;
  const known: readonly unknown[] = EFFECTS;
  if (!known.includes(value)) {
    throw new PuzzleDataError(path, `must be one of: ${EFFECTS.join(", ")}`);
  }
  return value as PuzzleEffect;
}

/** Checks one puzzle and returns it typed. Unknown extra fields are dropped. */
export function parsePuzzle(value: unknown, path = "puzzle"): Puzzle {
  const data = object(value, path);

  if (!Array.isArray(data.acceptedAnswers)) {
    throw new PuzzleDataError(`${path}.acceptedAnswers`, "must be an array (use [] for none)");
  }
  const acceptedAnswers = data.acceptedAnswers.map((answer, i) =>
    text(answer, `${path}.acceptedAnswers[${i}]`),
  );

  const reveal = object(data.reveal, `${path}.reveal`);
  const focus = object(reveal.focus, `${path}.reveal.focus`);
  const credit = object(data.credit, `${path}.credit`);
  const zoomLevels = parseZoomLevels(reveal.zoomLevels, `${path}.reveal.zoomLevels`);
  const chosenEffect = effect(data.effect, `${path}.effect`);

  return {
    id: id(data.id, `${path}.id`),
    imageUrl: text(data.imageUrl, `${path}.imageUrl`),
    answer: text(data.answer, `${path}.answer`),
    acceptedAnswers,
    reveal: {
      focus: {
        x: fraction(focus.x, `${path}.reveal.focus.x`),
        y: fraction(focus.y, `${path}.reveal.focus.y`),
      },
      zoomLevels,
    },
    credit: {
      source: text(credit.source, `${path}.credit.source`),
      license: text(credit.license, `${path}.credit.license`),
      ...(credit.url === undefined ? {} : { url: text(credit.url, `${path}.credit.url`) }),
    },
    aiSolvedLevel: aiSolvedLevel(data.aiSolvedLevel, zoomLevels.length, `${path}.aiSolvedLevel`),
    ...(chosenEffect === undefined ? {} : { effect: chosenEffect }),
  };
}

/**
 * Checks a list of puzzles (e.g. the contents of `src/puzzles/sample.json`).
 * Throws a `PuzzleDataError` naming the first bad field, so a typo in the data
 * fails loudly instead of showing a broken round.
 */
export function parsePuzzles(value: unknown, path = "puzzles"): Puzzle[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PuzzleDataError(path, "must be a non-empty array");
  }
  const puzzles = value.map((puzzle, i) => parsePuzzle(puzzle, `${path}[${i}]`));
  const seen = new Set<string>();
  puzzles.forEach((puzzle, i) => {
    if (seen.has(puzzle.id)) {
      throw new PuzzleDataError(`${path}[${i}].id`, `duplicate id "${puzzle.id}"`);
    }
    seen.add(puzzle.id);
  });
  return puzzles;
}
