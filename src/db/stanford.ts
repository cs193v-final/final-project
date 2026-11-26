// Stanford mode (#65): one fixed pack, no schedule. Owner: Jacky.
//
// The Stanford pack is the pack of kind "stanford" in the database. Its
// content (answers, images, credits) never lives in the repo: it's a content
// file in the git-ignored `content/` folder, loaded by `npm run db:seed` like
// the daily packs. `combineContent` allows at most one Stanford pack per seed.
// If the database ever has several (a pack replaced by one with a new id,
// since seeding never deletes a pack), the newest one is played; games of an
// older one still resume by their id.
//
// No "server-only" import, like the rest of src/db's content helpers, so tests
// can run it; it's still only for server code (it reads the database).

import { asc, desc, eq } from "drizzle-orm";

import type { Pack } from "../game/types.ts";
import type { AnyDb } from "./content.ts";
import { packPuzzles, packs } from "./schema.ts";

/** What the /stanford page shows before a game: no ids, answers or images. */
export type StanfordIntro = {
  /** `null`: nothing loaded yet (the real pack comes from the image picker, #181). */
  pack: { title: string; theme: string; puzzleCount: number } | null;
  /** A Stanford pack exists but can't be played (no puzzles): a content problem, logged on the server. */
  broken?: true;
};

/** Thrown when the Stanford pack exists but can't be played (it has no puzzles). Not the same as "not loaded yet". */
export class BrokenStanfordPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokenStanfordPackError";
  }
}

/**
 * The Stanford pack with its puzzles in order, or `null` if none is loaded.
 * The newest pack of kind "stanford" (by when it was first seeded, then id).
 * Throws `BrokenStanfordPackError` if that pack has no puzzles.
 */
export async function getStanfordPack(db: AnyDb): Promise<Pack | null> {
  const [newest] = await db
    .select({ id: packs.id, title: packs.title, theme: packs.theme, scoring: packs.scoring })
    .from(packs)
    .where(eq(packs.kind, "stanford"))
    .orderBy(desc(packs.createdAt), desc(packs.id))
    .limit(1);
  if (!newest) return null;
  const rows = await db
    .select({ puzzleId: packPuzzles.puzzleId })
    .from(packPuzzles)
    .where(eq(packPuzzles.packId, newest.id))
    .orderBy(asc(packPuzzles.position));
  if (rows.length === 0) throw new BrokenStanfordPackError(`Stanford pack ${newest.id} has no puzzles`);
  return {
    id: newest.id,
    kind: "stanford",
    title: newest.title,
    theme: newest.theme,
    puzzleIds: rows.map((r) => r.puzzleId),
    // Its own scoring (#64), like `getPack` and the daily return it.
    ...(newest.scoring === null ? {} : { scoring: newest.scoring }),
  };
}

/** The intro for /stanford. A pack that can't be played is `broken` (its cause goes to the server log). */
export async function getStanfordIntro(db: AnyDb): Promise<StanfordIntro> {
  try {
    const pack = await getStanfordPack(db);
    return { pack: pack && { title: pack.title, theme: pack.theme, puzzleCount: pack.puzzleIds.length } };
  } catch (error) {
    if (!(error instanceof BrokenStanfordPackError)) throw error;
    console.error(error.message);
    return { pack: null, broken: true };
  }
}
