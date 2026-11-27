import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { CreditsList } from "@/components/CreditsList";
import { TextLink } from "@/components/ui/controls";
import { PRACTICE_CONTENT } from "@/puzzles";
import { errorSummary } from "@/server/error-summary";
import { loadPastDailyCredits } from "@/server/credits";
import { GAME_NAME } from "@/site";

export const metadata: Metadata = {
  title: `Photo credits · ${GAME_NAME}`,
};

/**
 * Photo credits (#239): the author, license and source of every photo already
 * played. Today's and future dailies are left out so the page can't spoil
 * them; every round also shows its photo's credit once it ends.
 */
export default function CreditsPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <nav aria-label="Back" className="w-full max-w-md">
        <TextLink href="/" className="gap-1">
          <span aria-hidden="true">←</span>
          Home
        </TextLink>
      </nav>
      <h1 className="text-3xl font-semibold tracking-tight">Photo credits</h1>
      <p className="max-w-md text-center text-zinc-600 dark:text-zinc-400">
        Our photos are openly licensed, most from Wikimedia Commons, and cropped for the game. Today&apos;s and upcoming dailies are listed after they&apos;re played.
      </p>
      <Suspense fallback={<p className="text-zinc-600 dark:text-zinc-400">Loading credits…</p>}>
        <Credits />
      </Suspense>
    </main>
  );
}

async function Credits() {
  await connection();
  const practice = PRACTICE_CONTENT.puzzles.map((p) => p.credit);
  const dailies = await loadPastDailyCredits().catch((error: unknown) => {
    console.error(`Couldn't load photo credits: ${errorSummary(error)}`);
    return null;
  });
  return (
    <>
      <CreditsList practice={practice} dailies={dailies ?? []} />
      {dailies === null && (
        <p role="alert" className="max-w-md text-center text-zinc-700 dark:text-zinc-300">
          Couldn&apos;t load the daily photos&apos; credits. Please try again later.
        </p>
      )}
    </>
  );
}
