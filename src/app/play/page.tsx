import type { Metadata } from "next";
import { Suspense } from "react";
import { PracticeGame } from "@/components/game/PracticeGame";
import { PrototypeNotice, TextLink, PAGE_TITLE } from "@/components/ui/controls";
import { loadGame } from "@/server/games";
import { actAction, getGameAction, startGameAction } from "./actions";

export const metadata: Metadata = {
  title: "Practice · Zoom Out",
};

export default function PlayPage({ searchParams }: PageProps<"/play">) {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-md">
        {/* "Home", like the site header (#80). The arrow is decoration, so the link's name is just "Home". */}
        <TextLink href="/" className="gap-1">
          <span aria-hidden="true">←</span>
          Home
        </TextLink>
      </nav>
      <h1 className={PAGE_TITLE}>Practice</h1>
      <PrototypeNotice>Prototype: point values are still being tuned.</PrototypeNotice>
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
