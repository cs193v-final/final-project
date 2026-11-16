import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PracticeGame } from "@/components/game/PracticeGame";
import { loadGame } from "@/server/games";
import { actAction, getGameAction, startGameAction } from "./actions";

export const metadata: Metadata = {
  title: "Practice · Zoom Out",
};

export default function PlayPage({ searchParams }: PageProps<"/play">) {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-md">
        <Link href="/" className="text-sm font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
          ← Back to start
        </Link>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Practice</h1>
      <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
        Prototype: point values are still being tuned.
      </p>
      {/* The game depends on the request (URL and owner cookie), so it streams in at request time. */}
      <Suspense fallback={<p className="text-zinc-600 dark:text-zinc-400">Loading the game…</p>}>
        <Game searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * `/play?game=<id>` resumes that game (if it's this player's); `/play` starts
 * a new one in the browser, which then puts its id in the URL.
 */
async function Game({ searchParams }: Pick<PageProps<"/play">, "searchParams">) {
  const { game } = await searchParams;
  const initial = typeof game === "string" ? await loadGame(game) : null;
  return <PracticeGame initial={initial} start={startGameAction} act={actAction} get={getGameAction} />;
}
