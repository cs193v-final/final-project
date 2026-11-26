// The daily challenge on the server (#58). Server-only: it reads the database.
import "server-only";

import { cacheLife } from "next/cache";

import { getDb } from "@/db";
import { getDailyIntro, getDailyPack } from "@/db/daily";
import { getDailyStats, type DailyStats } from "@/db/daily-stats";
import { scoringFromStored } from "@/db/scoring";
import { assertDailyDate, dailyDateFor, DEFAULT_DAILY_RESET } from "@/game/daily-date";
import type { DailyIntro } from "@/game/daily";
import { runGameCall, type GameResult } from "@/game/game-result";
import { GameNotFoundError, resumeDaily, startOrResumeDaily } from "@/game/server-game";

import { deps, requestIpHash } from "./games";
import { checkStartLimits } from "./limits";
import { currentOrNewOwner, currentOwner } from "./owner";

/** The day `now` is in: one rule, `DEFAULT_DAILY_RESET` (#63, decided in #58). */
export const dailyDateAt = (now: Date) => dailyDateFor(now, DEFAULT_DAILY_RESET);

/**
 * Today's intro. The day is worked out per request (cheap, no database); the
 * intro for that day is cached, because it's the same for everyone, so
 * reloading /daily in a loop doesn't query the database each time (security
 * review of #100).
 */
export async function loadDailyIntro(now = new Date()): Promise<DailyIntro> {
  return cachedIntro(dailyDateAt(now));
}

/**
 * Cached per date (the argument is part of the cache key). After a reset the
 * date changes, so it's a new entry. "minutes": refreshed in the background
 * after a minute, so a pack seeded during the day shows up within about a
 * minute, and the database sees at most about one query a minute per server.
 * A broken day (a scheduled pack with no puzzles) is a result, so it's cached
 * too; only a database error is thrown, and isn't cached.
 */
async function cachedIntro(date: string): Promise<DailyIntro> {
  "use cache";
  cacheLife("minutes");
  return getDailyIntro(getDb(), date);
}

/**
 * Starting the daily can also fail because the day the player saw is over
 * (they opened /daily before the reset and pressed Start after it), or because
 * nothing is scheduled. Those get their own messages, not practice's.
 */
export type DailyStartResult = GameResult | { ok: false; error: "day-over" | "no-daily" };

/**
 * Start the daily for `date` (the day the intro showed), or resume the
 * player's game for it: one daily game per player per day (#58). `date` must
 * still be today, so a player who opened the page before the reset doesn't
 * silently get the next day's game ("day-over"). The pack is always the one
 * the server schedules for today; the browser only says which day it saw.
 * Creates the anonymous owner cookie on first play, like practice, and counts
 * toward the same start limits, per owner and per IP (#85, #210): a client
 * without a cookie is a new owner each time, so only the IP limit stops it
 * creating games. Resuming today's game doesn't count: Start (and reloading
 * /daily, through `loadTodaysDailyGame`) gets a player back to the daily they
 * already started, even at the limit, and writes nothing.
 */
export async function startTodaysDaily(date: unknown, now = new Date()): Promise<DailyStartResult> {
  const today = dailyDateAt(now);
  if (date !== today) return { ok: false, error: "day-over" };
  const db = getDb();
  let pack;
  try {
    pack = await getDailyPack(db, today);
  } catch (error) {
    console.error("Couldn't read today's daily pack", error);
    return { ok: false, error: "unavailable" };
  }
  if (pack === null) return { ok: false, error: "no-daily" };
  const daily = pack;
  return runGameCall(async () => {
    const owner = await currentOrNewOwner();
    const started = await resumeDaily(deps(db), owner, today);
    if (started !== null) return started;
    await checkStartLimits(db, owner, await requestIpHash(), now);
    // The pack's own scoring (#64) when it has one, checked like any stored
    // override: an invalid one (hand-written SQL, or one with the old
    // zoom-out fields from before #255) is logged and the default used.
    return startOrResumeDaily(deps(db), daily, today, owner, scoringFromStored(daily.id, daily.scoring ?? null));
  });
}

/**
 * The current player's daily game for the day `now` is in, if they've started
 * it; `null` if they haven't (or have no owner cookie yet). Doesn't create
 * anything. Read like any game (`resumeDaily`): owner and schema checks.
 */
export async function loadTodaysDailyGame(now = new Date()): Promise<GameResult | null> {
  const owner = await currentOwner();
  if (owner === null) return null;
  let notStarted = false;
  const result = await runGameCall(async () => {
    const view = await resumeDaily(deps(getDb()), owner, dailyDateAt(now));
    if (view === null) {
      notStarted = true;
      throw new GameNotFoundError(); // not logged; turned back into null below
    }
    return view;
  });
  return notStarted ? null : result;
}

/**
 * Per-image stats for the current player's *finished* daily of `date` (the
 * day it was played, from the intro, so a game started before midnight and
 * finished after it still has stats), or `null` (not started, still playing,
 * or no owner cookie). Scoped to the caller's own game: no game id is taken,
 * and a date only ever finds this owner's game. Aggregates only.
 */
export async function loadDailyStats(date: unknown): Promise<DailyStats | null> {
  if (typeof date !== "string") return null;
  // A real calendar date only: "2026-02-30" matches YYYY-MM-DD, but Postgres
  // can't cast it to a date and the query would throw.
  try {
    assertDailyDate(date);
  } catch {
    return null;
  }
  const owner = await currentOwner();
  if (owner === null) return null;
  const db = getDb();
  const game = await deps(db).games.findDaily(owner, date);
  if (game === null || !game.state.finished) return null;
  return getDailyStats(db, game.id);
}
