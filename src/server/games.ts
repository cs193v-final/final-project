// The server side of /play (#54): starts, loads and plays games for the
// current owner. Server-only. The Server Actions in src/app/play/actions.ts
// and the /play page call these; the browser only ever gets a `GameResult`
// (a `GameView` or an error code).
//
// browser → Server Action → this file (owner from the cookie) →
// server-game.ts (rules, scoring, answer hiding) → PgGameStore → Postgres
import "server-only";

import { getDb, type Db } from "@/db";
import { ensurePackRow, PgGameStore } from "@/db/games";
import { runGameCall, type GameResult } from "@/game/game-result";
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

/** Start a practice game for the current owner, creating the owner cookie if needed. */
export async function startPracticeGame(): Promise<GameResult> {
  return runGameCall(async () => {
    const owner = await currentOrNewOwner();
    const db = getDb();
    await ensurePracticePack(db);
    // TODO(#64): getScoringConfig(PRACTICE_PACK.id) once it lands.
    return startGame(deps(db), PRACTICE_PACK, owner, SCORING_CONFIG);
  });
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
  return runGameCall(async () => {
    const owner = await currentOwner();
    if (owner === null || typeof gameId !== "string") throw new GameNotFoundError();
    // `act` checks the revision (after the owner), so a stale tab can't act on a round it never saw (#107).
    return act(deps(getDb()), gameId, owner, action as GameAction, revision as number);
  });
}

/** The current owner's game as it is now (resume after a refresh). */
export async function loadGame(gameId: unknown): Promise<GameResult> {
  return runGameCall(async () => {
    const owner = await currentOwner();
    if (owner === null || typeof gameId !== "string") throw new GameNotFoundError();
    return getGame(deps(getDb()), gameId, owner);
  });
}
