import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { DailyLeaderboard } from "@/components/leaderboard/DailyLeaderboard";
import { ButtonLink, TextLink } from "@/components/ui/controls";
import { errorSummary } from "@/server/error-summary";
import { loadDailyLeaderboard } from "@/server/leaderboard";
import { GAME_NAME } from "@/site";

export const metadata: Metadata = {
  title: `Leaderboard · ${GAME_NAME}`,
};

/**
 * Today's daily leaderboard (#62). The day, and who's asking, depend on the
 * request, so the board is read at request time, inside Suspense (Next 16
 * Cache Components). The top list itself is cached (src/server/leaderboard.ts).
 */
export default function LeaderboardPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-md">
        <TextLink href="/" className="gap-1">
          <span aria-hidden="true">←</span>
          Home
        </TextLink>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Leaderboard</h1>
      <Suspense fallback={<p className="text-zinc-600 dark:text-zinc-400">Loading the leaderboard…</p>}>
        <Board />
      </Suspense>
    </main>
  );
}

async function Board() {
  await connection();
  const board = await loadDailyLeaderboard().catch((error: unknown) => {
    // Names and Postgres codes only: a failed query would carry a user id.
    console.error(`Couldn't load the leaderboard: ${errorSummary(error)}`);
    return null;
  });
  if (board !== null) return <DailyLeaderboard board={board} />;
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <p role="alert" className="text-zinc-700 dark:text-zinc-300">
        Couldn&apos;t load the leaderboard. Please try again later.
      </p>
      <ButtonLink href="/daily">Play today&apos;s daily</ButtonLink>
    </div>
  );
}
