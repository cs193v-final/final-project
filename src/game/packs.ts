// Packs, the daily schedule and content files (#52). Owner: Joseph.
//
// A content file is JSON with any of three lists:
//   { "packs": [Pack], "puzzles": [Puzzle], "schedule": [DailyEntry] }
// The practice pack lives in the repo (src/puzzles/). Daily, Stanford and lobby
// content never does: the seed script (scripts/seed.ts) loads it into the
// database from files kept outside the repo (see TECHNICAL.md → Content).
//
// No React, Next or database imports, so this runs in tests, in the app and in
// the seed script (Node runs it directly, so relative imports keep `.ts`).

import { id, object, parsePuzzle, PuzzleDataError, text } from "./puzzles.ts";
import type { DailyEntry, Pack, PackKind, Puzzle } from "./types.ts";

export const PACK_KINDS: readonly PackKind[] = ["practice", "daily", "stanford", "lobby"];

export type Content = { packs: Pack[]; puzzles: Puzzle[]; schedule: DailyEntry[] };

function list(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PuzzleDataError(path, "must be an array");
  return value;
}

/** Checks one pack. The puzzles it lists are checked against the content in `combineContent`. */
export function parsePack(value: unknown, path = "pack"): Pack {
  const data = object(value, path);
  const kind = data.kind;
  if (typeof kind !== "string" || !(PACK_KINDS as readonly string[]).includes(kind)) {
    throw new PuzzleDataError(`${path}.kind`, `must be one of ${PACK_KINDS.join(", ")}`);
  }
  if (data.scoring !== undefined) {
    // Per-pack scoring is stored by #64; until then, don't load unchecked values.
    throw new PuzzleDataError(`${path}.scoring`, "isn't supported by the seed script yet (#64)");
  }
  const puzzleIds = list(data.puzzleIds, `${path}.puzzleIds`).map((puzzleId, i) =>
    id(puzzleId, `${path}.puzzleIds[${i}]`),
  );
  if (puzzleIds.length === 0) throw new PuzzleDataError(`${path}.puzzleIds`, "must list at least one puzzle");
  puzzleIds.forEach((puzzleId, i) => {
    if (puzzleIds.indexOf(puzzleId) !== i) {
      throw new PuzzleDataError(`${path}.puzzleIds[${i}]`, `lists "${puzzleId}" twice`);
    }
  });
  return {
    id: id(data.id, `${path}.id`),
    kind: kind as PackKind,
    title: text(data.title, `${path}.title`),
    theme: text(data.theme, `${path}.theme`),
    puzzleIds,
  };
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** "YYYY-MM-DD", and a day that exists (no February 30). */
function calendarDate(value: unknown, path: string): string {
  const date = text(value, path);
  const match = DATE_PATTERN.exec(date);
  const [year, month, day] = (match?.slice(1) ?? []).map(Number);
  const parsed = match ? new Date(Date.UTC(year!, month! - 1, day!)) : undefined;
  if (!parsed || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) {
    throw new PuzzleDataError(path, "must be a real date written YYYY-MM-DD");
  }
  return date;
}

export function parseDailyEntry(value: unknown, path = "entry"): DailyEntry {
  const data = object(value, path);
  return { date: calendarDate(data.date, `${path}.date`), packId: id(data.packId, `${path}.packId`) };
}

/**
 * Checks the shape of one content file. `source` (e.g. the file name) starts
 * every error path. References between files are checked by `combineContent`.
 */
export function parseContent(value: unknown, source = "content"): Content {
  const data = object(value, source);
  const content: Content = {
    packs: list(data.packs, `${source}: packs`).map((p, i) => parsePack(p, `${source}: packs[${i}]`)),
    puzzles: list(data.puzzles, `${source}: puzzles`).map((p, i) => parsePuzzle(p, `${source}: puzzles[${i}]`)),
    schedule: list(data.schedule, `${source}: schedule`).map((e, i) =>
      parseDailyEntry(e, `${source}: schedule[${i}]`),
    ),
  };
  if (content.packs.length + content.puzzles.length + content.schedule.length === 0) {
    throw new PuzzleDataError(source, "has no packs, puzzles or schedule");
  }
  return content;
}

/**
 * Joins content files into one set and checks it as a whole: ids are unique,
 * every pack's puzzles exist, the schedule only uses daily packs (each on one
 * day), and no id or image URL gives an answer away (`findAnswerLeaks`).
 * Throws a `PuzzleDataError` naming the first problem.
 */
export function combineContent(parts: readonly { source: string; content: Content }[]): Content {
  const combined: Content = { packs: [], puzzles: [], schedule: [] };
  const where = new Map<string, string>(); // "puzzle:<id>" etc. → error path of its first definition

  const claim = (key: string, path: string, what: string) => {
    const first = where.get(key);
    if (first !== undefined) throw new PuzzleDataError(path, `duplicate ${what} (first at ${first})`);
    where.set(key, path);
  };

  for (const { source, content } of parts) {
    content.puzzles.forEach((p, i) => claim(`puzzle:${p.id}`, `${source}: puzzles[${i}].id`, `puzzle id "${p.id}"`));
    content.packs.forEach((p, i) => claim(`pack:${p.id}`, `${source}: packs[${i}].id`, `pack id "${p.id}"`));
    content.schedule.forEach((e, i) => claim(`date:${e.date}`, `${source}: schedule[${i}].date`, `date ${e.date}`));
    combined.puzzles.push(...content.puzzles);
    combined.packs.push(...content.packs);
    combined.schedule.push(...content.schedule);
  }

  // Stanford mode plays one fixed pack (#65), so a seed may bring at most one.
  const stanford = combined.packs.filter((p) => p.kind === "stanford");
  if (stanford.length > 1) {
    const [first, second] = stanford as [Pack, Pack];
    throw new PuzzleDataError(`pack ${second.id}: kind`, `only one stanford pack can be seeded at a time (also "${first.id}")`);
  }

  const puzzleIds = new Set(combined.puzzles.map((p) => p.id));
  const packsById = new Map(combined.packs.map((p) => [p.id, p]));
  const scheduledOn = new Map<string, string>();

  for (const { source, content } of parts) {
    content.packs.forEach((pack, i) => {
      pack.puzzleIds.forEach((puzzleId, j) => {
        if (!puzzleIds.has(puzzleId)) {
          throw new PuzzleDataError(`${source}: packs[${i}].puzzleIds[${j}]`, `no puzzle "${puzzleId}" in the content`);
        }
      });
    });
    content.schedule.forEach((entry, i) => {
      const path = `${source}: schedule[${i}].packId`;
      const pack = packsById.get(entry.packId);
      if (!pack) throw new PuzzleDataError(path, `no pack "${entry.packId}" in the content`);
      if (pack.kind !== "daily") throw new PuzzleDataError(path, `"${pack.id}" is a ${pack.kind} pack, not daily`);
      const other = scheduledOn.get(pack.id);
      if (other !== undefined) throw new PuzzleDataError(path, `"${pack.id}" is already scheduled on ${other}`);
      scheduledOn.set(pack.id, entry.date);
    });
  }

  const [leak] = findAnswerLeaks(combined);
  if (leak) throw new PuzzleDataError(leak.path, leak.problem);
  return combined;
}

// ---------------------------------------------------------------------------
// Answer leaks (#36): ids and image URLs reach the browser, so they must not
// contain an answer. Credits may (they're only shown after the round).
// ---------------------------------------------------------------------------

/** `%67iraffe` → `giraffe`, so URL-encoded names can't hide an answer. */
function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // a stray "%": check it as written
  }
}

/** Lowercase ASCII letters and digits per word, accents removed: "Café-Noir" → ["cafe", "noir"]. */
function words(value: string): string[] {
  return decoded(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Letters and digits are separate words, so "ben1" reads as "ben", "1".
    .replace(/([a-z])(?=[0-9])|([0-9])(?=[a-z])/gu, "$1$2 ")
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

/** Short words that say nothing about an answer on their own. */
const FILLER = new Set(["the", "and", "for", "los", "las", "les", "des", "del", "von", "van"]);

/**
 * What counts as giving `answer` away: the whole answer, and each word of 3 or
 * more letters ("ben" for "Big Ben"), also as a singular ("cherries" →
 * "cherry", "tomatoes" → "tomato", "giraffes" → "giraffe") and, for a word
 * ending in "y", as a plural ("cherry" → "cherries"). Other plurals contain the
 * singular already ("peach" is in "peaches").
 */
function needles(answer: string): string[] {
  const parts = words(answer);
  const found = new Set<string>([parts.join("")]);
  for (const word of parts) {
    if (word.length >= 3 && !FILLER.has(word)) found.add(word);
    if (word.length >= 5 && word.endsWith("ies")) found.add(`${word.slice(0, -3)}y`);
    else if (word.length >= 5 && word.endsWith("es")) found.add(word.slice(0, -2)).add(word.slice(0, -1));
    else if (word.length >= 5 && word.endsWith("s")) found.add(word.slice(0, -1));
    if (word.length >= 4 && word.endsWith("y")) found.add(`${word.slice(0, -1)}ies`);
  }
  return [...found].filter(Boolean);
}

/** Long needles match anywhere ("giraffe" in "/img/giraffe2.jpg"); short ones only as a whole word ("ox" in "ox-1", not "box"). */
function leaks(field: string, needle: string): boolean {
  const tokens = words(field);
  return needle.length >= 4 ? tokens.join("").includes(needle) : tokens.includes(needle);
}

export type AnswerLeak = { path: string; problem: string };

/** Every id or image URL that contains one of its puzzles' answers or accepted answers. */
export function findAnswerLeaks(content: Pick<Content, "packs" | "puzzles">): AnswerLeak[] {
  const found: AnswerLeak[] = [];
  const byId = new Map(content.puzzles.map((p) => [p.id, p]));
  const check = (path: string, value: string, puzzle: Puzzle) => {
    for (const answer of [puzzle.answer, ...puzzle.acceptedAnswers]) {
      const needle = needles(answer).find((n) => leaks(value, n));
      if (needle !== undefined) {
        found.push({ path, problem: `"${value}" gives away the answer "${answer}" (contains "${needle}")` });
        return;
      }
    }
  };
  for (const puzzle of content.puzzles) {
    check(`puzzle ${puzzle.id}: id`, puzzle.id, puzzle);
    check(`puzzle ${puzzle.id}: imageUrl`, puzzle.imageUrl, puzzle);
  }
  for (const pack of content.packs) {
    for (const puzzleId of pack.puzzleIds) {
      const puzzle = byId.get(puzzleId);
      if (puzzle) check(`pack ${pack.id}: id`, pack.id, puzzle);
    }
  }
  return found;
}
