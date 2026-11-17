import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { DailyIntroScreen } from "@/components/daily/DailyIntroScreen";
import { DailyPlay } from "@/components/daily/DailyPlay";
import { ButtonLink, TextLink } from "@/components/ui/controls";
import { actAction, getGameAction } from "@/app/play/actions";
import { loadDailyIntro, loadTodaysDailyGame } from "@/server/daily";

import { dailyStatsAction, startDailyAction } from "./actions";
import { GAME_NAME } from "@/site";

export const metadata: Metadata = {
  title: `Daily challenge · ${GAME_NAME}`,
};

/**
 * The daily challenge (#58). Today's pack depends on the time of the request,
 * so it's read at request time, inside Suspense (Next 16 Cache Components).
 * A player who already started today's game sees it again (resumed, or their
 * result): one daily game per player per day.
 */
export default function DailyPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-md">
        {/* "Home", like /play and the site header (#80). The arrow is decoration. */}
        <TextLink href="/" className="gap-1">
          <span aria-hidden="true">←</span>
          Home
        </TextLink>
      </nav>
      <h1 className="sr-only">Daily challenge</h1>
      <Suspense fallback={<p className="text-zinc-600 dark:text-zinc-400">Loading today&apos;s challenge…</p>}>
        <Today />
      </Suspense>
    </main>
  );
}

async function Today() {
  await connection();
  // One clock reading per request, so the intro and the player's game are for
  // the same day even at the reset. Both loads at once (no extra round trip).
  const now = new Date();
  const [intro, initial] = await Promise.all([
    loadDailyIntro(now).catch((error: unknown) => {
      console.error("Couldn't load today's daily challenge", error);
      return null;
    }),
    loadTodaysDailyGame(now).catch((error: unknown) => {
      console.error("Couldn't load this player's daily game", error);
      return null;
    }),
  ]);
  if (intro !== null && !intro.broken) {
    if (intro.pack === null) return <DailyIntroScreen intro={intro} />;
    return (
      <DailyPlay
        intro={intro}
        initial={initial}
        start={startDailyAction}
        act={actAction}
        get={getGameAction}
        loadStats={dailyStatsAction}
      />
    );
  }
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <p role="alert" className="text-zinc-700 dark:text-zinc-300">
        Couldn&apos;t load today&apos;s challenge. Please try again later, or play the practice images meanwhile.
      </p>
      <ButtonLink href="/play">Play practice</ButtonLink>
    </div>
  );
}
