// Daily streaks on the server (#63). Server-only: it reads the database.
//
// Only logged-in players have a streak (#58: anonymous games never count), so
// both loaders return `null` for a logged-out visitor without querying games.
// Read-only and called from Server Components (the home page and /daily), not
// from a Server Action, so there's no new public endpoint to rate-limit (#85):
// one indexed query per page view, next to the session lookup the header
// already makes.
import "server-only";

import { getCurrentUserOrLoggedOut } from "@/auth/session";
import { getDb } from "@/db";
import { getPlayedDailyDates } from "@/db/streaks";
import { summarizeStreak, type StreakSummary } from "@/game/streak";

import { dailyDateAt } from "./daily";

/** The player's streak as of the day `now` is in (the home screen), or `null` when logged out. */
export async function loadStreak(now = new Date()): Promise<StreakSummary | null> {
  const user = await getCurrentUserOrLoggedOut();
  if (user === null) return null;
  return summarizeStreak(await getPlayedDailyDates(getDb(), user.id), dailyDateAt(now));
}

/**
 * The player's streak once they've finished the daily of `date` (the day the
 * intro showed), or `null` when logged out. For the daily result, which only
 * shows once the server says that game is finished, so `date` counts as
 * played even if the page loaded before the last image (the finished game is
 * then in the database too). Relative to `date`, not the clock, so a daily
 * started before the reset and finished after it shows that day's streak.
 */
export async function loadStreakAfterDaily(date: string): Promise<StreakSummary | null> {
  const user = await getCurrentUserOrLoggedOut();
  if (user === null) return null;
  const played = await getPlayedDailyDates(getDb(), user.id);
  return summarizeStreak([...played, date], date);
}
