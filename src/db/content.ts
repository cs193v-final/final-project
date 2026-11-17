// Loads packs, puzzles and the daily schedule into the database, and reads
// them back (#52). Owner: Joseph. Server-only by location (src/db/), but with no
// "server-only" import, so the seed script (scripts/seed.ts) can run it in Node.
//
// Takes any Drizzle Postgres database (Neon in the app and the seed script,
// PGlite in tests). Uses no transactions, because the Neon HTTP driver has
// none. Instead, seeding is safe to run again: every write is an upsert or a
// replace of the same rows, so a run that stops partway is fixed by running it
// again. It never deletes a puzzle, a pack or a schedule entry.

import { and, asc, count, eq, getTableColumns, inArray, sql, type Table } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { Content } from "../game/packs.ts";
import type { DailyEntry, Pack, Puzzle } from "../game/types.ts";
import { dailySchedule, games, packPuzzles, packs, puzzles } from "./schema.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any schema, any driver
export type AnyDb = PgDatabase<PgQueryResultHKT, any>;

/** Thrown when seeding would change something players have already played. Nothing is written. */
export class SeedRefusedError extends Error {
  readonly problems: string[]; // a plain field, so Node can strip the types

  constructor(problems: string[]) {
    super(`Seeding refused, nothing was written:\n- ${problems.join("\n- ")}`);
    this.name = "SeedRefusedError";
    this.problems = problems;
  }
}

export type SeedSummary = {
  puzzles: number;
  packs: number;
  /** Packs whose puzzle list was new or changed. */
  packOrders: number;
  schedule: number;
};

const puzzleRow = (p: Puzzle) => ({
  id: p.id,
  answer: p.answer,
  acceptedAnswers: p.acceptedAnswers,
  imageUrl: p.imageUrl,
  focusX: p.reveal.focus.x,
  focusY: p.reveal.focus.y,
  zoomLevels: p.reveal.zoomLevels,
  creditSource: p.credit.source,
  creditLicense: p.credit.license,
  creditUrl: p.credit.url ?? null,
  aiSolvedLevel: p.aiSolvedLevel,
});

/** `SET col = excluded.col` for an upsert, for every listed column. */
function excluded<T extends Table>(table: T, keys: readonly (keyof T["_"]["columns"] & string)[]) {
  const columns = getTableColumns(table);
  return Object.fromEntries(keys.map((key) => [key, sql.raw(`excluded."${columns[key]!.name}"`)]));
}

async function playedPackIds(db: AnyDb, packIds: string[]): Promise<Set<string>> {
  if (packIds.length === 0) return new Set();
  const rows = await db
    .select({ packId: games.packId, n: count() })
    .from(games)
    .where(inArray(games.packId, packIds))
    .groupBy(games.packId);
  return new Set(rows.filter((r) => r.n > 0).map((r) => r.packId));
}

async function currentOrders(db: AnyDb, packIds: string[]): Promise<Map<string, string[]>> {
  const orders = new Map<string, string[]>();
  if (packIds.length === 0) return orders;
  const rows = await db
    .select()
    .from(packPuzzles)
    .where(inArray(packPuzzles.packId, packIds))
    .orderBy(asc(packPuzzles.packId), asc(packPuzzles.position));
  for (const row of rows) orders.set(row.packId, [...(orders.get(row.packId) ?? []), row.puzzleId]);
  return orders;
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Writes checked content (from `combineContent`) to the database. First checks
 * that it wouldn't change what players already played, and throws a
 * `SeedRefusedError` before writing anything if it would:
 * - a pack's puzzle list can't change once the pack has games;
 * - a date can't move to another pack once its current pack has games.
 * Fixing a typo in a puzzle (answer, credit, focus) is allowed.
 */
export async function seedContent(db: AnyDb, content: Content): Promise<SeedSummary> {
  const packIds = content.packs.map((p) => p.id);
  const orders = await currentOrders(db, packIds);
  const changedPacks = content.packs.filter((p) => !sameList(orders.get(p.id), p.puzzleIds));

  const dates = content.schedule.map((e) => e.date);
  const scheduled =
    dates.length === 0 ? [] : await db.select().from(dailySchedule).where(inArray(dailySchedule.date, dates));
  const movedDates = scheduled.filter((row) => content.schedule.some((e) => e.date === row.date && e.packId !== row.packId));

  const played = await playedPackIds(db, [...changedPacks.map((p) => p.id), ...movedDates.map((r) => r.packId)]);
  const problems = [
    ...changedPacks
      .filter((p) => played.has(p.id) && orders.has(p.id))
      .map((p) => `pack ${p.id}: its puzzle list changed, but it has already been played`),
    ...movedDates
      .filter((r) => played.has(r.packId))
      .map((r) => `schedule ${r.date}: moves away from pack ${r.packId}, which has already been played`),
  ];
  if (problems.length > 0) throw new SeedRefusedError(problems);

  // Puzzles before packs, packs before their puzzle lists and the schedule (foreign keys).
  if (content.puzzles.length > 0) {
    await db
      .insert(puzzles)
      .values(content.puzzles.map(puzzleRow))
      .onConflictDoUpdate({
        target: puzzles.id,
        set: excluded(puzzles, [
          "answer",
          "acceptedAnswers",
          "imageUrl",
          "focusX",
          "focusY",
          "zoomLevels",
          "creditSource",
          "creditLicense",
          "creditUrl",
          "aiSolvedLevel",
        ]),
      });
  }
  if (content.packs.length > 0) {
    await db
      .insert(packs)
      .values(content.packs.map((p) => ({ id: p.id, kind: p.kind, title: p.title, theme: p.theme })))
      .onConflictDoUpdate({ target: packs.id, set: excluded(packs, ["kind", "title", "theme"]) });
  }
  for (const pack of changedPacks) {
    // Delete and re-insert: moving rows in place could clash with the
    // (pack, position) key partway through. Only for packs nobody has played.
    await db.delete(packPuzzles).where(eq(packPuzzles.packId, pack.id));
    await db
      .insert(packPuzzles)
      .values(pack.puzzleIds.map((puzzleId, i) => ({ packId: pack.id, puzzleId, position: i + 1 })));
  }
  if (content.schedule.length > 0) {
    await db
      .insert(dailySchedule)
      .values(content.schedule)
      .onConflictDoUpdate({ target: dailySchedule.date, set: excluded(dailySchedule, ["packId"]) });
  }

  return {
    puzzles: content.puzzles.length,
    packs: content.packs.length,
    packOrders: changedPacks.length,
    schedule: content.schedule.length,
  };
}

/** The puzzles with these ids, in the same order, with answers. Throws if any is missing. Server-only. */
export async function getPuzzles(db: AnyDb, ids: readonly string[]): Promise<Puzzle[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(puzzles).where(inArray(puzzles.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => {
    const r = byId.get(id);
    if (!r) throw new Error(`getPuzzles: no puzzle "${id}"`);
    return {
      id: r.id,
      imageUrl: r.imageUrl,
      answer: r.answer,
      acceptedAnswers: r.acceptedAnswers,
      reveal: { focus: { x: r.focusX, y: r.focusY }, zoomLevels: r.zoomLevels },
      credit: {
        source: r.creditSource,
        license: r.creditLicense,
        ...(r.creditUrl === null ? {} : { url: r.creditUrl }),
      },
      aiSolvedLevel: r.aiSolvedLevel,
    };
  });
}

/** A pack with its puzzle ids in play order, or `null` if there's no such pack. */
export async function getPack(db: AnyDb, id: string): Promise<Pack | null> {
  const [row] = await db.select().from(packs).where(eq(packs.id, id));
  if (!row) return null;
  const order = await currentOrders(db, [id]);
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    theme: row.theme,
    puzzleIds: order.get(id) ?? [],
    ...(row.scoring === null ? {} : { scoring: row.scoring }),
  };
}

/** The daily schedule entry for one date ("YYYY-MM-DD"), or `null`. Which date is "today" is #58. */
export async function getDailyEntry(db: AnyDb, date: string): Promise<DailyEntry | null> {
  const [row] = await db
    .select({ date: dailySchedule.date, packId: dailySchedule.packId })
    .from(dailySchedule)
    .innerJoin(packs, and(eq(packs.id, dailySchedule.packId), eq(packs.kind, "daily")))
    .where(eq(dailySchedule.date, date));
  return row ?? null;
}
