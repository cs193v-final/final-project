// The server side of /play (#54): starts, loads and plays games for the
// current owner. Server-only. The Server Actions in src/app/play/actions.ts
// and the /play page call these; the browser only ever gets a `GameResult`
// (a `GameView` or an error code).
//
// browser → Server Action → this file (owner from the cookie) →
// server-game.ts (rules, scoring, answer hiding) → PgGameStore → Postgres
import "server-only";

import { headers } from "next/headers";

import { getDb, type Db } from "@/db";
import { ensurePackRow, findUnfinishedGames, PgGameStore } from "@/db/games";
import { RateLimitedError, runGameCall, type GameResult } from "@/game/game-result";
import { SCORING_CONFIG } from "@/game/scoring-config";
import {
  act,
  GameNotFoundError,
  getGame,
  puzzleSourceFrom,
  startGame,
  type GameDeps,
} from "@/game/server-game";
import type { GameAction } from "@/game/types";
import { PRACTICE_PACK, SAMPLE_PUZZLES } from "@/puzzles";

import { hashIp, ipHmacKey } from "./ip-key";
import { checkActionLimits, checkStartLimits, MAX_UNFINISHED_GAMES } from "./limits";
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
function deps(db: Db): GameDeps {
  return {
    // No game_rounds rows yet: they reference `puzzles`, which only the seed
    // script fills in.
    games: new PgGameStore(db, { recordRounds: false }),
    // TODO(follow-up to #52): getPuzzles(db, ids) from src/db/content.ts.
    puzzles: puzzleSourceFrom(SAMPLE_PUZZLES),
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
 * limiting only. On Vercel, `x-forwarded-for` is set by Vercel's edge (a
 * client-sent value is overwritten) and its first entry is the client;
 * `x-real-ip` is the same address. Elsewhere these headers can be forged, so
 * they're never used for anything but rate limits. No header: `"unknown"`.
 */
async function requestIpHash(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
  return hashIp(ip, ipHmacKey());
}

/**
 * Start a practice game for the current owner, creating the owner cookie if
 * needed. Rate-limited per owner and per IP (#85). Reuses a game instead of
 * creating a row when the owner has one nobody has played yet (a refresh of
 * /play, a second "Start practice"), or already has `MAX_UNFINISHED_GAMES`
 * unfinished games (then their latest unfinished practice game is resumed).
 */
export async function startPracticeGame(): Promise<GameResult> {
  return runGameCall(async () => {
    const owner = await currentOrNewOwner();
    const db = getDb();
    await checkStartLimits(db, owner, await requestIpHash(), new Date());
    await ensurePracticePack(db);
    const unfinished = await findUnfinishedGames(db, owner, PRACTICE_PACK.id);
    const atCap = unfinished.count >= MAX_UNFINISHED_GAMES;
    const reuse = unfinished.untouchedId ?? (atCap ? unfinished.latestId : null);
    if (reuse !== null) return getGame(deps(db), reuse, owner);
    // At the cap with no practice game to resume (only other packs' games).
    if (atCap) throw new RateLimitedError("maxUnfinishedGames");
    // TODO(#64): getScoringConfig(PRACTICE_PACK.id) once it lands.
    return startGame(deps(db), PRACTICE_PACK, owner, SCORING_CONFIG);
  });
}

/**
 * Apply one action from the browser to the current owner's game. Both
 * arguments are untrusted. A game that doesn't exist and one that belongs to
 * someone else both give `not-found`. `act` validates the action
 * (`parseGameAction`, the one validation path): a bad one gives `invalid`.
 * A conflict (another tab saved first) gives `conflict` and is not retried.
 */
export async function actOnGame(gameId: unknown, action: unknown): Promise<GameResult> {
  return runGameCall(async () => {
    const owner = await currentOwner();
    if (owner === null || typeof gameId !== "string") throw new GameNotFoundError();
    const db = getDb();
    await checkActionLimits(db, owner, await requestIpHash(), new Date());
    return act(deps(db), gameId, owner, action as GameAction);
  });
}

/** The current owner's game as it is now (resume after a refresh). Counts toward the action limits (#85). */
export async function loadGame(gameId: unknown): Promise<GameResult> {
  return runGameCall(async () => {
    const owner = await currentOwner();
    if (owner === null || typeof gameId !== "string") throw new GameNotFoundError();
    const db = getDb();
    await checkActionLimits(db, owner, await requestIpHash(), new Date());
    return getGame(deps(db), gameId, owner);
  });
}
