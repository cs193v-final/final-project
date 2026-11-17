// Loads packs, puzzles and the daily schedule into the database, and reads
// them back (#52). Owner: Joseph. Server-only by location (src/db/), but with no
// "server-only" import, so the seed script (scripts/seed.ts) can run it in Node.
//
// Takes any Drizzle Postgres database (Neon in the app and the seed script,
// PGlite in tests). Uses no transactions, because the Neon HTTP driver has
// none. Instead, seeding is safe to run again: every write is an upsert or a
// replace of the same rows, so a run that stops partway is fixed by running it
// again. It never deletes a puzzle or a pack. The only schedule entry it
// removes is the old day of an unplayed pack that moves to another day.

import { and, asc, count, eq, getTableColumns, inArray, sql, type Table } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { Content } from "../game/packs.ts";
import type { DailyEntry, Pack, Puzzle } from "../game/types.ts";
import { dailySchedule, gameRounds, games, packPuzzles, packs, puzzles } from "./schema.ts";

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
 * - a date can't move to another pack once its current pack has games;
 * - a played pack can't move to another date;
 * - a played puzzle can't change its number of zoom levels;
 * - a scheduled or played pack can't change its kind.
 * Moving an unplayed pack to another date clears its old date, so a pack is
 * never on two days. Fixing a typo in a puzzle (answer, credit, focus, image
 * URL, zoom values) is allowed.
 */
export async function seedContent(db: AnyDb, content: Content): Promise<SeedSummary> {
  const packIds = content.packs.map((p) => p.id);
  const orders = await currentOrders(db, packIds);
  const changedPacks = content.packs.filter((p) => !sameList(orders.get(p.id), p.puzzleIds));

  const dates = content.schedule.map((e) => e.date);
  const scheduled =
    dates.length === 0 ? [] : await db.select().from(dailySchedule).where(inArray(dailySchedule.date, dates));
  const movedDates = scheduled.filter((row) => content.schedule.some((e) => e.date === row.date && e.packId !== row.packId));

  // A pack is on one day only. If the database already has a pack from this
  // content on a date the content doesn't mention, the pack is moving: its old
  // day is cleared (unless it has been played, below). Dates in the content
  // are overwritten anyway, so they don't count.
  const scheduledPackIds = [...new Set(content.schedule.map((e) => e.packId))];
  const elsewhere =
    scheduledPackIds.length === 0
      ? []
      : (await db.select().from(dailySchedule).where(inArray(dailySchedule.packId, scheduledPackIds))).filter(
          (row) => !dates.includes(row.date),
        );

  // A puzzle someone has played keeps its number of zoom levels: a game in
  // progress could otherwise be on a level the puzzle no longer has.
  const puzzleIds = content.puzzles.map((p) => p.id);
  const storedPuzzles =
    puzzleIds.length === 0
      ? []
      : await db.select({ id: puzzles.id, zoomLevels: puzzles.zoomLevels }).from(puzzles).where(inArray(puzzles.id, puzzleIds));
  const levelCountChanged = storedPuzzles.filter(
    (row) => content.puzzles.find((p) => p.id === row.id)!.reveal.zoomLevels.length !== row.zoomLevels.length,
  );
  const levelChangeIds = levelCountChanged.map((r) => r.id);
  const packsOfChanged =
    levelChangeIds.length === 0
      ? []
      : await db.select().from(packPuzzles).where(inArray(packPuzzles.puzzleId, levelChangeIds));
  const roundsOfChanged =
    levelChangeIds.length === 0
      ? []
      : await db
          .selectDistinct({ puzzleId: gameRounds.puzzleId })
          .from(gameRounds)
          .where(inArray(gameRounds.puzzleId, levelChangeIds));

  // A scheduled or played pack keeps its kind: a daily pack that stops being
  // daily would silently leave its day without a challenge.
  const storedPacks =
    packIds.length === 0 ? [] : await db.select({ id: packs.id, kind: packs.kind }).from(packs).where(inArray(packs.id, packIds));
  const kindChanged = storedPacks.filter((row) => content.packs.find((p) => p.id === row.id)!.kind !== row.kind);
  const kindChangeIds = kindChanged.map((r) => r.id);
  const scheduledKindChanged =
    kindChangeIds.length === 0
      ? new Set<string>()
      : new Set(
          (await db.select({ packId: dailySchedule.packId }).from(dailySchedule).where(inArray(dailySchedule.packId, kindChangeIds))).map(
            (r) => r.packId,
          ),
        );

  const played = await playedPackIds(db, [
    ...changedPacks.map((p) => p.id),
    ...movedDates.map((r) => r.packId),
    ...elsewhere.map((r) => r.packId),
    ...packsOfChanged.map((r) => r.packId),
    ...kindChangeIds,
  ]);
  const playedPuzzles = new Set([
    ...roundsOfChanged.map((r) => r.puzzleId),
    ...packsOfChanged.filter((r) => played.has(r.packId)).map((r) => r.puzzleId),
  ]);
  const problems = [
    ...changedPacks
      .filter((p) => played.has(p.id) && orders.has(p.id))
      .map((p) => `pack ${p.id}: its puzzle list changed, but it has already been played`),
    ...movedDates
      .filter((r) => played.has(r.packId))
      .map((r) => `schedule ${r.date}: moves away from pack ${r.packId}, which has already been played`),
    ...elsewhere
      .filter((r) => played.has(r.packId))
      .map((r) => {
        const to = content.schedule.find((e) => e.packId === r.packId)!.date;
        return `pack ${r.packId}: can't move from ${r.date} to ${to}, it has already been played`;
      }),
    ...levelCountChanged
      .filter((r) => playedPuzzles.has(r.id))
      .map((r) => {
        const now = content.puzzles.find((p) => p.id === r.id)!.reveal.zoomLevels.length;
        return `puzzle ${r.id}: its number of zoom levels changed (${r.zoomLevels.length} → ${now}), but it has already been played`;
      }),
    ...kindChanged
      .filter((r) => played.has(r.id) || scheduledKindChanged.has(r.id))
      .map((r) => {
        const now = content.packs.find((p) => p.id === r.id)!.kind;
        const why = played.has(r.id) ? "it has already been played" : "it is on the daily schedule";
        return `pack ${r.id}: its kind changed (${r.kind} → ${now}), but ${why}`;
      }),
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
  if (elsewhere.length > 0) {
    // Clear a moving pack's old day first. Only unplayed packs get here.
    await db.delete(dailySchedule).where(inArray(dailySchedule.date, elsewhere.map((r) => r.date)));
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
