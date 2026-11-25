import type { Metadata } from "next";
import { Suspense } from "react";

import { StanfordGame } from "@/components/game/StanfordGame";
import { ButtonLink, PrototypeNotice, TextLink } from "@/components/ui/controls";
import { actAction, getGameAction } from "@/app/play/actions";
import { loadGame } from "@/server/games";
import { loadStanfordIntro } from "@/server/stanford";
import { GAME_NAME } from "@/site";

import { startStanfordAction } from "./actions";
import { errorSummary } from "@/server/error-summary";

export const metadata: Metadata = {
  title: `Stanford · ${GAME_NAME}`,
};

/**
 * Stanford mode (#65): one fixed pack of campus spots, flags and mascots,
 * played like practice (as often as you like). The pack comes from the
 * database; until it's loaded, the page says so instead of starting a game.
 */
export default function StanfordPage({ searchParams }: PageProps<"/stanford">) {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-md">
        {/* "Home", like /play and the site header (#80). The arrow is decoration. */}
        <TextLink href="/" className="gap-1">
          <span aria-hidden="true">←</span>
          Home
        </TextLink>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Stanford</h1>
      {/* The game depends on the request (URL and owner cookie), so it streams in at request time. */}
      <Suspense fallback={<p className="text-zinc-600 dark:text-zinc-400">Loading Stanford mode…</p>}>
        <Stanford searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * `/stanford?game=<id>` resumes that game (if it's this player's); `/stanford`
 * starts a new one in the browser, which then puts its id in the URL.
 */
async function Stanford({ searchParams }: Pick<PageProps<"/stanford">, "searchParams">) {
  // Reading the URL first makes the rest request-time, so the cached intro is
  // never filled at build time (there may be no database then).
  const { game } = await searchParams;
  const [intro, initial] = await Promise.all([
    loadStanfordIntro().catch((error: unknown) => {
      console.error(`Couldn't load the Stanford pack: ${errorSummary(error)}`);
      return null;
    }),
    typeof game === "string" ? loadGame(game) : null,
  ]);

  // A game in progress resumes even if the intro couldn't be read.
  if (initial?.ok || (intro?.pack && !intro.broken)) {
    return (
      <>
        {intro?.pack ? (
          <p className="max-w-md text-center text-zinc-700 dark:text-zinc-300">
            {intro.pack.theme} · {intro.pack.puzzleCount} {intro.pack.puzzleCount === 1 ? "image" : "images"}
          </p>
        ) : null}
        <PrototypeNotice>Prototype: point values are still being tuned.</PrototypeNotice>
        <StanfordGame initial={initial} start={startStanfordAction} act={actAction} get={getGameAction} />
      </>
    );
  }

  const notLoaded = intro !== null && !intro.broken;
  return (
    <div className="flex max-w-md flex-col items-center gap-4 text-center">
      <p role={notLoaded ? "status" : "alert"} className="text-zinc-700 dark:text-zinc-300">
        {notLoaded
          ? "Stanford mode is coming soon: its campus photos aren't loaded yet. Play the practice images meanwhile."
          : "Couldn't load Stanford mode. Please try again later, or play the practice images meanwhile."}
      </p>
      <ButtonLink href="/play">Play practice</ButtonLink>
    </div>
  );
}
