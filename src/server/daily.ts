// The daily challenge on the server (#58). Server-only: it reads the database.
import "server-only";

import { cacheLife } from "next/cache";

import { getDb } from "@/db";
import { getDailyIntro, getDailyPack, todaysDate } from "@/db/daily";
import { getDailyStats, type DailyStats } from "@/db/daily-stats";
import { runGameCall, type GameResult } from "@/game/game-result";
import { DEFAULT_DAILY_RESET } from "@/game/daily-date";
import type { DailyIntro } from "@/game/daily";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { GameNotFoundError, startOrResumeDaily, toGameView } from "@/game/server-game";

import { deps } from "./games";
import { currentOrNewOwner, currentOwner } from "./owner";

/**
 * Today's intro. The day is worked out per request (cheap, no database); the
 * intro for that day is cached, because it's the same for everyone, so
 * reloading /daily in a loop doesn't query the database each time (security
 * review of #100). The reset rule is `DEFAULT_DAILY_RESET`, the one place it's
 * set (#63, decided in #58).
 */
export async function loadDailyIntro(now = new Date()): Promise<DailyIntro> {
  return cachedIntro(todaysDate(now, DEFAULT_DAILY_RESET));
}

/**
 * Cached per date (the argument is part of the cache key). After a reset the
 * date changes, so it's a new entry. "minutes": refreshed in the background
 * after a minute, so a pack seeded during the day shows up within about a
 * minute, and the database sees at most about one query a minute per server.
 * A thrown error isn't cached.
 */
async function cachedIntro(date: string): Promise<DailyIntro> {
  "use cache";
  cacheLife("minutes");
  return getDailyIntro(getDb(), date, DEFAULT_DAILY_RESET);
}

/**
 * Start today's daily for the current player, or resume the one they already
 * have (in play or finished): one daily game per player per day (#58). Creates
 * the anonymous owner cookie on first play, like practice. The day and the
 * pack are decided here, on the server, never by the browser.
 */
export async function startTodaysDaily(now = new Date()): Promise<GameResult> {
  return runGameCall(async () => {
    const date = todaysDate(now, DEFAULT_DAILY_RESET);
    const db = getDb();
    const pack = await getDailyPack(db, date);
    if (pack === null) throw new GameNotFoundError(); // nothing scheduled today
    const owner = await currentOrNewOwner();
    // TODO(#64): getScoringConfig(pack.id) once it lands.
    return startOrResumeDaily(deps(db), pack, date, owner, SCORING_CONFIG);
  });
}

/**
 * The current player's daily game for today, if they've started it; `null` if
 * they haven't (or have no owner cookie yet). Doesn't create anything.
 */
export async function loadTodaysDailyGame(now = new Date()): Promise<GameResult | null> {
  const owner = await currentOwner();
  if (owner === null) return null;
  const date = todaysDate(now, DEFAULT_DAILY_RESET);
  const d = deps(getDb());
  const game = await d.games.findDaily(owner, date);
  if (game === null) return null;
  return runGameCall(async () => toGameView(game, await d.puzzles.getPuzzles(game.state.puzzleIds)));
}

/**
 * Per-image stats for the current player's *finished* daily today, or `null`
 * (not started, still playing, or no owner cookie). Takes no game id: the
 * player can only ever see stats for their own game. Aggregates only.
 */
export async function loadTodaysDailyStats(now = new Date()): Promise<DailyStats | null> {
  const owner = await currentOwner();
  if (owner === null) return null;
  const db = getDb();
  const game = await deps(db).games.findDaily(owner, todaysDate(now, DEFAULT_DAILY_RESET));
  if (game === null || !game.state.finished) return null;
  return getDailyStats(db, game.id);
}
