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
import type { GameAction, Pack } from "@/game/types";
import { SAMPLE_PUZZLES } from "@/puzzles";

import { currentOrNewOwner, currentOwner } from "./owner";

/**
 * The practice pack. Its puzzles stay in code (`SAMPLE_PUZZLES`) until packs
 * move to the database (#52, Joseph); then this becomes a `packs` row like
 * any other. The id is fixed and opaque; its row is inserted on first use.
 */
export const PRACTICE_PACK: Pack = {
  id: "pk_3f9c2a7e51d84b06",
  kind: "practice",
  title: "Practice",
  theme: "Mixed",
  puzzleIds: SAMPLE_PUZZLES.map((p) => p.id),
};

function deps(db: Db): GameDeps {
  return {
    // No game_rounds rows yet: they reference `puzzles`, and the practice
    // puzzles aren't in the database until #52.
    games: new PgGameStore(db, { recordRounds: false }),
    // TODO(#52): look puzzles up in the database, by the game's pack.
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
    return act(deps(getDb()), gameId, owner, action as GameAction);
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
