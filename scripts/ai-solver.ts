// Beat the AI's solver (#56): CLIP plays every puzzle on its stored level
// images, what players see, and the first view its top guess is the answer
// becomes the puzzle's `aiSolvedLevel` (`null` = never). The command is
// scripts/solve-ai.ts; this is the part the tests use.
//
// `db:seed` writes `ai_solved_level` from the content file, so the solver writes
// the value into the content files as well as the database. Then the production
// seed carries it, and a later re-seed keeps it.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { eq, inArray } from "drizzle-orm";

import type { AnyDb } from "../src/db/content.ts";
import { getImageFile, getLevelSrcs, IMAGE_ID } from "../src/db/images.ts";
import { puzzles as puzzlesTable } from "../src/db/schema.ts";
import type { Content } from "../src/game/packs.ts";
import type { Puzzle } from "../src/game/types.ts";
import { solveLevels, type Classifier, type LevelResult } from "../src/images/clip/analyze.ts";
import { buildLabels } from "../src/images/clip/labels.ts";
import type { ClipModel } from "../src/images/clip/model.ts";
import { sameSettings, settingsOf, storedImageSettings } from "./seed-images.ts";

/**
 * The answers CLIP chooses between for each puzzle, besides the generic list:
 * its own, then those of every pack it's in (its theme). A puzzle in no pack
 * gets only its own.
 */
export function answersByPuzzle(content: Pick<Content, "packs" | "puzzles">): Map<string, string[]> {
  const answerOf = new Map(content.puzzles.map((p) => [p.id, p.answer]));
  return new Map(
    content.puzzles.map((puzzle) => {
      const packs = content.packs.filter((pack) => pack.puzzleIds.includes(puzzle.id));
      const theme = packs.flatMap((pack) => pack.puzzleIds.flatMap((id) => answerOf.get(id) ?? []));
      return [puzzle.id, [puzzle.answer, ...theme]];
    }),
  );
}

/**
 * `model`, remembering every text it has embedded: each pack needs the same
 * 666 generic labels, and they're only run through CLIP once.
 */
export function cachedTexts(model: ClipModel): ClipModel {
  const cache = new Map<string, Float32Array>();
  return {
    name: model.name,
    embedImages: (images) => model.embedImages(images),
    async embedTexts(texts) {
      const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
      if (missing.length > 0) (await model.embedTexts(missing)).forEach((v, i) => cache.set(missing[i]!, v));
      return texts.map((t) => cache.get(t)!);
    },
  };
}

/** The image id in a level URL (`/img/<id>.webp`), or null. */
function imageId(src: string): string | null {
  const id = /^\/img\/([0-9a-f]+)\.webp$/.exec(src)?.[1];
  return id !== undefined && IMAGE_ID.test(id) ? id : null;
}

/**
 * Each puzzle's stored level images, tightest first. Throws, naming every
 * puzzle that isn't seeded yet, isn't fully cut, or was cut from other image
 * settings than the content has now: run `npm run db:seed` first.
 */
export async function storedLevels(db: AnyDb, puzzles: readonly Puzzle[]): Promise<Map<string, Uint8Array[]>> {
  const ids = puzzles.map((p) => p.id);
  const [settings, srcs] = await Promise.all([storedImageSettings(db, ids), getLevelSrcs(db, ids)]);
  const problems = puzzles.flatMap((puzzle) => {
    const stored = settings.get(puzzle.id);
    if (stored === undefined) return [`${puzzle.id}: not in the database`];
    if (!sameSettings(stored, settingsOf(puzzle))) return [`${puzzle.id}: its image, focus or zoom levels changed since the last seed`];
    if (srcs.get(puzzle.id)?.length !== puzzle.reveal.zoomLevels.length) return [`${puzzle.id}: its level images aren't all cut`];
    return [];
  });
  if (problems.length > 0) {
    throw new Error(`Run \`npm run db:seed\` first, so the solver plays what players see:\n- ${problems.join("\n- ")}`);
  }

  const levels = new Map<string, Uint8Array[]>();
  for (const puzzle of puzzles) {
    const files = await Promise.all(
      srcs.get(puzzle.id)!.map(async (src, level) => {
        const id = imageId(src);
        const file = id === null ? null : await getImageFile(db, id);
        if (file === null) throw new Error(`${puzzle.id}: level ${level}'s image (${src}) is missing; run \`npm run db:seed -- --recut\``);
        return file.bytes;
      }),
    );
    levels.set(puzzle.id, files);
  }
  return levels;
}

export type Solved = { aiSolvedLevel: Puzzle["aiSolvedLevel"]; levels: LevelResult[] };

/**
 * Plays every puzzle in `content` on its stored levels. `classifierFor` makes
 * a classifier for a set of labels; puzzles with the same labels share one.
 */
export async function solvePuzzles(
  db: AnyDb,
  content: Pick<Content, "packs" | "puzzles">,
  classifierFor: (labels: string[]) => Promise<Classifier>,
): Promise<Map<string, Solved>> {
  const levels = await storedLevels(db, content.puzzles);
  const answers = answersByPuzzle(content);
  const classifiers = new Map<string, Promise<Classifier>>();
  const solved = new Map<string, Solved>();
  for (const puzzle of content.puzzles) {
    const labels = buildLabels(answers.get(puzzle.id)!);
    const key = JSON.stringify(labels);
    if (!classifiers.has(key)) classifiers.set(key, classifierFor(labels));
    solved.set(puzzle.id, await solveLevels(await classifiers.get(key)!, levels.get(puzzle.id)!, puzzle));
  }
  return solved;
}

/**
 * Writes each puzzle's `aiSolvedLevel` to the database, only where it changed.
 * One update per puzzle, so a run that stops partway is fixed by running it
 * again. Returns the ids it changed.
 */
export async function saveAiSolvedLevels(db: AnyDb, levels: ReadonlyMap<string, Puzzle["aiSolvedLevel"]>): Promise<string[]> {
  const ids = [...levels.keys()];
  if (ids.length === 0) return [];
  const current = new Map(
    (
      await db
        .select({ id: puzzlesTable.id, aiSolvedLevel: puzzlesTable.aiSolvedLevel })
        .from(puzzlesTable)
        .where(inArray(puzzlesTable.id, ids))
    ).map((r) => [r.id, r.aiSolvedLevel]),
  );
  const changed = ids.filter((id) => current.has(id) && current.get(id) !== levels.get(id));
  for (const id of changed) {
    await db.update(puzzlesTable).set({ aiSolvedLevel: levels.get(id) ?? null }).where(eq(puzzlesTable.id, id));
  }
  return changed;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A content file's JSON with each listed puzzle's `aiSolvedLevel` set: a file
 * that's a list of puzzles (src/puzzles/sample.json) or one with `puzzles`.
 * Puzzles not listed are left alone. Returns the ids it changed.
 */
export function setAiSolvedLevels(json: unknown, levels: ReadonlyMap<string, Puzzle["aiSolvedLevel"]>): string[] {
  const puzzles = Array.isArray(json) ? json : isObject(json) && Array.isArray(json.puzzles) ? json.puzzles : [];
  const changed: string[] = [];
  for (const puzzle of puzzles) {
    if (!isObject(puzzle) || typeof puzzle.id !== "string" || !levels.has(puzzle.id)) continue;
    const level = levels.get(puzzle.id) ?? null;
    if ((puzzle.aiSolvedLevel ?? null) === level) continue;
    puzzle.aiSolvedLevel = level;
    changed.push(puzzle.id);
  }
  return changed;
}

/** Lines no longer than this keep a short list or object on one line. */
const INLINE_WIDTH = 100;

const isContainer = (v: unknown) => typeof v === "object" && v !== null;

/** `value` on one line, if it holds no lists or objects. */
function inline(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.some(isContainer) ? undefined : `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.some(([, v]) => isContainer(v))) return undefined;
    return entries.length === 0 ? "{}" : `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

function format(value: unknown, indent: string, used: number): string {
  const flat = inline(value);
  if (flat !== undefined && used + flat.length <= INLINE_WIDTH) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[\n${value.map((v) => inner + format(v, inner, inner.length)).join(",\n")}\n${indent}]`;
  }
  if (isObject(value)) {
    const lines = Object.entries(value).map(([k, v]) => {
      const key = `${inner}${JSON.stringify(k)}: `;
      return key + format(v, inner, key.length);
    });
    return lines.length === 0 ? "{}" : `{\n${lines.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * JSON the way the content files are written (src/puzzles/*.json): two-space
 * indents, with a short list or object of plain values on one line, like
 * `"zoomLevels": [14, 8, 4.5, 2.5, 1]`. Ends with a newline.
 */
export function formatJson(value: unknown): string {
  return `${format(value, "", 0)}\n`;
}
