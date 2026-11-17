import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { DailyIntroScreen } from "@/components/daily/DailyIntroScreen";
import { loadDailyIntro } from "@/server/daily";
import { GAME_NAME } from "@/site";

export const metadata: Metadata = {
  title: `Daily challenge · ${GAME_NAME}`,
};

/**
 * The daily challenge (#58). Today's pack depends on the time of the request,
 * so it's read at request time, inside Suspense (Next 16 Cache Components).
 * Not linked from the home screen until the game itself is playable (#54).
 */
export default function DailyPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-12">
      <h1 className="sr-only">Daily challenge</h1>
      <Suspense fallback={<p className="text-zinc-600 dark:text-zinc-400">Loading today&apos;s challenge…</p>}>
        <Today />
      </Suspense>
    </main>
  );
}

async function Today() {
  await connection();
  const intro = await loadDailyIntro().catch((error: unknown) => {
    console.error("Couldn't load today's daily challenge", error);
    return null;
  });
  if (intro !== null) return <DailyIntroScreen intro={intro} />;
  return (
    <p role="alert" className="max-w-md text-center text-zinc-700 dark:text-zinc-300">
      Couldn&apos;t load today&apos;s challenge. Please try again later.
    </p>
  );
}
