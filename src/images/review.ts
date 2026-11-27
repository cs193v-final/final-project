// Image picker, step 2 (#180): what a person decides about each candidate on
// the local review page (scripts/review-images.ts), and turning the approved
// ones into a content file the seed script loads. Scripts only: app code
// never imports this.
//
// Each theme's folder, content/candidates/<theme>/, holds the photos and
// candidates.json from `npm run images:find` (#179), plus review.json with
// the decisions made here, and pack.json with the pack being built (title,
// theme, kind, day and play order) so it survives a reload. Export writes content/<theme>.json (one pack) and
// copies its photos to content/photos/<pack id>/. Everything stays in the
// git-ignored content/ folder.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { combineContent, parseContent, type Content } from "../game/packs.ts";
import { EFFECTS } from "../game/puzzles.ts";
import type { Pack, PackKind, Puzzle, PuzzleEffect } from "../game/types.ts";
import { readCandidates, type Candidate } from "./openverse.ts";

/** Today's game still cuts zoom levels (#57); these are the practice pack's. */
export const DEFAULT_ZOOM_LEVELS = [14, 8, 4.5, 2.5, 1];

export type ReviewStatus = "pending" | "approved" | "rejected";

/** What the reviewer decided about one candidate. Everything is optional until it's approved. */
export type Review = {
  status: ReviewStatus;
  effect?: PuzzleEffect;
  focus?: { x: number; y: number }; // 0–1 of width and height; zoom, spotlight and swirl centre here
  answer?: string; // overrides the answer it was searched for
  acceptedAnswers?: string[];
  note?: string;
};

export type ReviewFile = Record<string, Review>; // by candidate id

export const THEME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
export const FILE_PATTERN = /^pz-[0-9a-f]{8}\.(jpg|png|webp)$/u;

const MAX_TEXT = 200;

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT) {
    throw new Error(`${name} must be text of 1 to ${MAX_TEXT} characters`);
  }
  return value.trim();
}

/** Checks a review sent by the page. Throws a message for the page to show. */
export function parseReview(value: unknown): Review {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("a review must be an object");
  const data = value as Record<string, unknown>;
  const statuses: unknown[] = ["pending", "approved", "rejected"];
  if (!statuses.includes(data.status)) throw new Error("status must be pending, approved or rejected");
  const review: Review = { status: data.status as ReviewStatus };
  if (data.effect !== undefined && data.effect !== null) {
    if (!(EFFECTS as readonly unknown[]).includes(data.effect)) throw new Error(`effect must be one of ${EFFECTS.join(", ")}`);
    review.effect = data.effect as PuzzleEffect;
  }
  if (data.focus !== undefined && data.focus !== null) {
    const f = data.focus as Record<string, unknown>;
    const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
    if (typeof f !== "object" || !ok(f.x) || !ok(f.y)) throw new Error("focus must be { x, y } from 0 to 1");
    review.focus = { x: f.x as number, y: f.y as number };
  }
  if (data.answer !== undefined && data.answer !== null && data.answer !== "") review.answer = text(data.answer, "answer");
  if (data.acceptedAnswers !== undefined) {
    if (!Array.isArray(data.acceptedAnswers) || data.acceptedAnswers.length > 20) throw new Error("acceptedAnswers must be a list of up to 20");
    review.acceptedAnswers = data.acceptedAnswers.map((a, i) => text(a, `acceptedAnswers[${i}]`));
  }
  if (data.note !== undefined && data.note !== null && data.note !== "") {
    if (typeof data.note !== "string" || data.note.length > 1000) throw new Error("note must be text of up to 1000 characters");
    review.note = data.note;
  }
  if (review.status === "approved" && review.effect === undefined) throw new Error("pick an effect before approving");
  return review;
}

export function readReviews(dir: string): ReviewFile {
  const file = join(dir, "review.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ReviewFile) : {};
}

function writeJson(file: string, value: unknown) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file); // never half-written
}

/** Saves one decision. Throws if `id` isn't a candidate in this folder. */
export function saveReview(dir: string, id: string, review: Review): void {
  if (!readCandidates(dir).some((c) => c.id === id)) throw new Error(`no candidate "${id}" in this theme`);
  const reviews = readReviews(dir);
  reviews[id] = review;
  writeJson(join(dir, "review.json"), reviews);
}

export type ReviewedCandidate = Candidate & { review: Review };

/** Every candidate in a theme folder with its decision (pending if none). */
export function reviewedCandidates(dir: string): ReviewedCandidate[] {
  const reviews = readReviews(dir);
  return readCandidates(dir).map((c) => ({ ...c, review: reviews[c.id] ?? { status: "pending" } }));
}

export type ExportRequest = {
  title: string; // shown to players, e.g. "Fruit"
  theme: string; // the intro's "Today: …"
  kind: Extract<PackKind, "daily" | "stanford">;
  puzzleIds: string[]; // approved candidates, in play order (easy to hard)
  date?: string; // optional daily date "YYYY-MM-DD" to schedule it on
};

export function parseExportRequest(value: unknown): ExportRequest {
  if (typeof value !== "object" || value === null) throw new Error("export needs title, theme, kind and puzzleIds");
  const data = value as Record<string, unknown>;
  if (data.kind !== "daily" && data.kind !== "stanford") throw new Error("kind must be daily or stanford");
  if (!Array.isArray(data.puzzleIds) || data.puzzleIds.length === 0 || data.puzzleIds.length > 20) {
    throw new Error("pick 1 to 20 approved photos for the pack");
  }
  return {
    title: text(data.title, "title"),
    theme: text(data.theme, "theme"),
    kind: data.kind,
    puzzleIds: data.puzzleIds.map((id, i) => text(id, `puzzleIds[${i}]`)),
    ...(typeof data.date === "string" && data.date !== "" ? { date: data.date } : {}),
  };
}

/**
 * The pack being built for a theme, saved as the reviewer goes (pack.json in
 * the theme's folder). Every field is optional: it's a draft. Nothing in it
 * is checked against the candidates until export.
 */
export type PackDraft = Partial<ExportRequest>;

/** What was last exported for a theme (content/<theme>.json), for the page to compare with the draft. */
export type ExportedPack = ExportRequest & { packId: string };

/** Checks a draft sent by the page; throws a message for the page to show. Empty text means "not set". */
export function parsePackDraft(value: unknown): PackDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("a pack draft must be an object");
  const data = value as Record<string, unknown>;
  const draft: PackDraft = {};
  for (const key of ["title", "theme"] as const) {
    if (typeof data[key] === "string" && data[key].trim() !== "") draft[key] = text(data[key], key);
  }
  if (data.kind === "daily" || data.kind === "stanford") draft.kind = data.kind;
  if (typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(data.date)) draft.date = data.date;
  if (Array.isArray(data.puzzleIds)) {
    if (data.puzzleIds.length > 100) throw new Error("a pack draft can list up to 100 photos");
    draft.puzzleIds = data.puzzleIds.map((id, i) => text(id, `puzzleIds[${i}]`));
  }
  return draft;
}

/** Saves the draft for a theme folder. */
export function savePackDraft(dir: string, draft: PackDraft): void {
  writeJson(join(dir, "pack.json"), draft);
}

/** The pack last exported for `theme`, or null if it hasn't been (or the file isn't one export wrote). */
export function readExportedPack(contentDir: string, theme: string): ExportedPack | null {
  if (!THEME_PATTERN.test(theme)) return null;
  const file = join(contentDir, `${theme}.json`);
  if (!existsSync(file)) return null;
  try {
    const content = JSON.parse(readFileSync(file, "utf8")) as Content;
    const pack = content.packs[0];
    if (pack === undefined || (pack.kind !== "daily" && pack.kind !== "stanford")) return null;
    const date = content.schedule.find((d) => d.packId === pack.id)?.date;
    return { packId: pack.id, title: pack.title, theme: pack.theme, kind: pack.kind, puzzleIds: pack.puzzleIds, ...(date === undefined ? {} : { date }) };
  } catch {
    return null;
  }
}

/**
 * The draft for a theme folder: pack.json if there is one, else what was last
 * exported (so a theme exported before drafts were saved picks up where it
 * left off), else empty.
 */
export function readPackDraft(dir: string, exported: ExportedPack | null): PackDraft {
  const file = join(dir, "pack.json");
  if (existsSync(file)) {
    try {
      return parsePackDraft(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return {};
    }
  }
  if (exported === null) return {};
  return { title: exported.title, theme: exported.theme, kind: exported.kind, puzzleIds: exported.puzzleIds, ...(exported.date === undefined ? {} : { date: exported.date }) };
}

const newPackId = () => `pk_${randomBytes(8).toString("hex")}`;

/**
 * Builds the pack's content (checked by the seed script's own `parseContent`
 * and `combineContent`, including the answer-leak check) from approved
 * candidates. Throws a message for the page if something isn't ready.
 */
export function buildContent(candidates: ReviewedCandidate[], request: ExportRequest, packId: string): Content {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const puzzles: Puzzle[] = request.puzzleIds.map((id) => {
    const c = byId.get(id);
    if (c === undefined) throw new Error(`no candidate "${id}"`);
    if (c.review.status !== "approved") throw new Error(`${id} isn't approved`);
    const focus = c.review.focus ?? { x: 0.5, y: 0.5 };
    return {
      id: c.id,
      imageUrl: `photos/${packId}/${c.file}`,
      answer: c.review.answer ?? c.answer,
      acceptedAnswers: c.review.acceptedAnswers ?? [],
      reveal: { focus, zoomLevels: DEFAULT_ZOOM_LEVELS },
      credit: c.credit,
      aiSolvedLevel: null,
      ...(c.review.effect === undefined ? {} : { effect: c.review.effect }),
    };
  });
  const pack: Pack = { id: packId, kind: request.kind, title: request.title, theme: request.theme, puzzleIds: request.puzzleIds };
  const raw = {
    packs: [pack],
    puzzles,
    schedule: request.date === undefined ? [] : [{ date: request.date, packId }],
  };
  // The same checks as `npm run db:seed` (formats, ids, answer leaks), so an export always loads.
  return combineContent([{ source: "export", content: parseContent(raw, "export") }]);
}

export type ExportResult = { file: string; packId: string; photos: number };

/**
 * Writes content/<theme>.json and copies the photos to content/photos/<pack id>/.
 * Exporting the same theme again keeps its pack id, so a re-export updates the
 * pack instead of making a second one.
 */
export function exportPack(contentDir: string, themeDir: string, theme: string, request: ExportRequest): ExportResult {
  if (!THEME_PATTERN.test(theme)) throw new Error("bad theme folder name");
  const file = join(contentDir, `${theme}.json`);
  let packId = newPackId();
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, "utf8")) as { packs?: { id?: unknown }[] };
    const id = existing.packs?.[0]?.id;
    if (typeof id === "string" && /^pk_[0-9a-f]{16}$/u.test(id)) packId = id;
  }
  const candidates = reviewedCandidates(themeDir);
  const content = buildContent(candidates, request, packId);
  const photoDir = join(contentDir, "photos", packId);
  mkdirSync(photoDir, { recursive: true });
  for (const puzzle of content.puzzles) {
    const name = puzzle.imageUrl.split("/").pop()!;
    if (!FILE_PATTERN.test(name)) throw new Error(`unexpected photo name ${name}`);
    copyFileSync(join(themeDir, name), join(photoDir, name));
  }
  writeJson(file, content);
  savePackDraft(themeDir, request); // the draft is now what was exported
  return { file, packId, photos: content.puzzles.length };
}
