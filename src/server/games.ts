// The server side of /play (#54): starts, loads and plays games for the
// current owner. Server-only. The Server Actions in src/app/play/actions.ts
// and the /play page call these; the browser only ever gets a `GameResult`
// (a `GameView` or an error code).
//
// browser → Server Action → this file (owner from the cookie) →
// server-game.ts (rules, scoring, answer hiding) → PgGameStore → Postgres
import "server-only";

import { connection } from "next/server";

import { limitsAddress } from "@/auth/limits-address";
import { requestIp } from "@/auth/session";
import { getVault } from "@/crypto/vault";
import { getDb, type Db } from "@/db";
import { getPuzzles } from "@/db/content";
import { ensurePackRow, findUnfinishedGames, PgGameStore, UnfinishedGamesCapError } from "@/db/games";
import { getLevelSrcs } from "@/db/images";
import { getScoringConfig } from "@/db/scoring";
import { runGameCall, type GameResult } from "@/game/game-result";
import { errorForLog } from "@/game/log-safe";
import {
  act,
  GameNotFoundError,
  GameUnreadableError,
  getGame,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
  type GameOwner,
} from "@/game/server-game";
import type { GameAction, GameView, Pack, ScoringConfig } from "@/game/types";
import { PRACTICE_PACK, SAMPLE_PUZZLES } from "@/puzzles";

import { hashIp, ipHmacKey } from "./ip-key";
import { checkActionLimits, checkStartLimits, MAX_UNFINISHED_GAMES_PER_PACK } from "./limits";
import { currentOrNewOwner, currentOwner } from "./owner";

/**
 * /play plays #52's practice pack (`PRACTICE_PACK` from src/puzzles/, one id
 * everywhere) and reads its puzzles from the repo copy (`SAMPLE_PUZZLES`), not
 * from the database. So /play works on a database that has been migrated but
 * not seeded: its `packs` row is inserted on first use (`ensurePackRow`, ON
 * CONFLICT DO NOTHING), and the seed script upserts the same row and adds the
 * puzzles. Reading them from the database, and then writing `game_rounds`, is
 * a follow-up once seeding is part of every deploy.
 */
export function deps(db: Db): GameDeps {
  const practice = puzzleSourceFrom(SAMPLE_PUZZLES);
  const practiceIds = new Set(SAMPLE_PUZZLES.map((p) => p.id));
  return {
    // game_rounds rows reference `puzzles`. Practice puzzles may not be seeded
    // (they're read from the repo), so practice games don't record rounds;
    // every other pack's puzzles are in the database, so those do (the daily
    // result's per-image stats, #58, and leaderboards, #62, read them).
    // The unfinished-games cap (#85) is checked by the store, atomically (#225).
    games: new PgGameStore(db, getVault(), {
      recordRounds: (state) => state.pack.kind !== "practice",
      maxUnfinishedPerPack: MAX_UNFINISHED_GAMES_PER_PACK,
    }),
    // Practice puzzles from the repo copy (so /play works on an unseeded
    // database); everything else, e.g. the daily (#58), from the database.
    puzzles: {
      getPuzzles: (ids) => (ids.every((id) => practiceIds.has(id)) ? practice.getPuzzles(ids) : getPuzzles(db, ids)),
    },
    // Per-level images (#57), cut by `npm run db:seed`. A practice puzzle that
    // isn't cut yet is still shown whole and cropped in the browser; any other
    // puzzle without levels can't be shown (server-game.ts refuses it).
    levels: { getLevelSrcs: (puzzleIds) => getLevelSrcs(db, puzzleIds) },
  };
}

let practicePackRow: Promise<void> | undefined;

/** Insert the practice pack's `packs` row once per server instance. */
function ensurePracticePack(db: Db): Promise<void> {
  practicePackRow ??= ensurePackRow(db, PRACTICE_PACK).catch((error: unknown) => {
    practicePackRow = undefined; // try again on the next request
    throw error;
  });
  return practicePackRow;
}

/**
 * The client's IP address as a keyed hash (src/server/ip-key.ts), for rate
 * limiting only, or `null` when the per-IP limits don't apply. The address is
 * read the same way as for login (`requestIp()`, `x-vercel-forwarded-for`
 * first), and the same rule decides whether it counts (`limitsAddress`): on
 * Vercel always (no address: one shared `"unknown"` bucket); elsewhere not for
 * loopback or a missing address, so local and e2e runs don't share one count.
 * The per-owner limits apply either way.
 */
export async function requestIpHash(): Promise<string | null> {
  const ip = await requestIp();
  return limitsAddress(ip) ? hashIp(ip, ipHmacKey()) : null;
}

/**
 * Start a practice game for the current owner, creating the owner cookie if
 * needed. Rate-limited per owner and per IP (#85); see `startOrReuseGame`.
 */
export async function startPracticeGame(): Promise<GameResult> {
  await connection(); // request time before `new Date()`; see loadGame (#169)
  return runGameCall(async () => {
    const owner = await currentOrNewOwner();
    const db = getDb();
    await checkStartLimits(db, owner, await requestIpHash(), new Date());
    await ensurePracticePack(db);
    // The pack's stored scoring (#64), read once here and kept in the game's
    // state, so changing it only affects games started afterwards.
    return startOrReuseGame(db, owner, PRACTICE_PACK, () => getScoringConfig(PRACTICE_PACK.id));
  });
}

/**
 * Start a game of `pack` for `owner`, after the start limits were checked.
 * Reuses a game instead of creating a row when the owner has one of this pack
 * nobody has played yet (a refresh, a second "Start"), or already has
 * `MAX_UNFINISHED_GAMES_PER_PACK` unfinished games of it (then the latest one
 * that can be read is resumed). The cap is per pack, so other packs' games never block this
 * one, and at the cap there is always a game of this pack to resume.
 * `scoring` is only read when a new game is created. Used by practice and
 * Stanford mode (#65); the daily has its own one-game-per-day rule.
 *
 * The check here is only a fast path: the store enforces the cap atomically
 * (#225). When a parallel start takes the last slot first, `startGame` throws
 * `UnfinishedGamesCapError` and the latest readable game is resumed, as at the cap.
 */
export async function startOrReuseGame(
  db: Db,
  owner: GameOwner,
  pack: Pack,
  scoring: () => Promise<ScoringConfig> | ScoringConfig,
): Promise<GameView> {
  const unfinished = await findUnfinishedGames(db, owner, pack.id, MAX_UNFINISHED_GAMES_PER_PACK);
  const atCap = unfinished.count >= MAX_UNFINISHED_GAMES_PER_PACK;
  // The untouched game first; at the cap, then the others, latest first.
  const reuse = [unfinished.untouchedId, ...(atCap ? unfinished.recentIds : [])].filter(
    (id, i, ids): id is string => id !== null && ids.indexOf(id) === i,
  );
  const resumed = await resumeFirstReadable(db, owner, reuse);
  if (resumed.view !== undefined) return resumed.view;
  // At the cap with none that loads (most likely a wrong key): report it.
  if (atCap && resumed.unreadable !== null) throw resumed.unreadable;
  try {
    return await startGame(deps(db), pack, owner, await scoring());
  } catch (error) {
    // Another start for this owner took the last slot first (#225): resume, as at the cap.
    if (!(error instanceof UnfinishedGamesCapError)) throw error;
    const { recentIds } = await findUnfinishedGames(db, owner, pack.id, MAX_UNFINISHED_GAMES_PER_PACK);
    const resumedAfterRace = await resumeFirstReadable(db, owner, recentIds);
    if (resumedAfterRace.view !== undefined) return resumedAfterRace.view;
    throw resumedAfterRace.unreadable ?? error;
  }
}

/**
 * Resume the first of `ids` that loads. A game that can't be decrypted (#164)
 * is skipped and logged, so "Start a new game" doesn't land on it again; the
 * last such error is returned when none loads.
 */
async function resumeFirstReadable(
  db: Db,
  owner: GameOwner,
  ids: readonly string[],
): Promise<{ view?: GameView; unreadable: GameUnreadableError | null }> {
  let unreadable: GameUnreadableError | null = null;
  for (const id of ids) {
    try {
      return { view: await getGame(deps(db), id, owner), unreadable };
    } catch (error) {
      if (!(error instanceof GameUnreadableError)) throw error;
      console.error("skipped an unreadable game:", JSON.stringify(errorForLog(error)));
      unreadable = error;
    }
  }
  return { unreadable };
}

/**
 * Apply one action from the browser to the current owner's game. All three
 * arguments are untrusted. A game that doesn't exist and one that belongs to
 * someone else both give `not-found`, whatever the action or revision. `act`
 * validates the action (`parseGameAction`) and the revision: a bad one gives
 * `invalid`. A revision that's no longer the game's (another tab moved it on,
 * or a response was lost) gives `conflict`, and the action is not retried.
 */
export async function actOnGame(gameId: unknown, action: unknown, revision: unknown): Promise<GameResult> {
  await connection(); // request time before `new Date()`; see loadGame (#169)
  return runGameCall(async () => {
    const owner = await currentOwner();
    if (owner === null || typeof gameId !== "string") throw new GameNotFoundError();
    const db = getDb();
    await checkActionLimits(db, owner, await requestIpHash(), new Date());
    // `act` checks the revision (after the owner), so a stale tab can't act on a round it never saw (#107).
    return act(deps(db), gameId, owner, action as GameAction, revision as number);
  });
}

/** The current owner's game as it is now (resume after a refresh). Counts toward the action limits (#85). */
export async function loadGame(gameId: unknown): Promise<GameResult> {
  // Finding the owner reads the request (cookies, and the session for a
  // logged-in player), and the rate limits read the clock (`new Date()`).
  // Mark request time first, outside runGameCall: while Next prerenders
  // /play, connection() rejects to stop the render, and that signal has to
  // reach Next. Inside runGameCall it would be caught, logged as "game call
  // failed" and turned into "unavailable". startPracticeGame and actOnGame do
  // the same (#169).
  await connection();
  return runGameCall(async () => {
    const owner = await currentOwner();
    if (owner === null || typeof gameId !== "string") throw new GameNotFoundError();
    const db = getDb();
    await checkActionLimits(db, owner, await requestIpHash(), new Date());
    return getGame(deps(db), gameId, owner);
  });
}
