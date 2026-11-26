import { connection } from "next/server";
import { Suspense } from "react";

import { StreakNote } from "@/components/daily/StreakNote";
import { StartScreen } from "@/components/StartScreen";
import { loadPracticeScoring } from "@/server/practice-scoring";
import { loadStreak } from "@/server/streaks";
import { errorSummary } from "@/server/error-summary";

/**
 * The home page. "How to play" uses the practice pack's scoring (#204), a
 * cached read that's part of the prerendered page, not a query per request.
 */
export default async function Home() {
  return (
    <StartScreen
      scoring={await loadPracticeScoring()}
      streak={
        // Reads the session cookie and the clock, so it streams in per request
        // (Cache Components); the rest of the home screen stays static.
        <Suspense fallback={null}>
          <HomeStreak />
        </Suspense>
      }
    />
  );
}

/** The logged-in player's daily streak (#63); nothing when logged out, or if it can't be loaded. */
async function HomeStreak() {
  await connection();
  const streak = await loadStreak(new Date()).catch((error: unknown) => {
    console.error(`Couldn't load this player's streak: ${errorSummary(error)}`);
    return null;
  });
  return <StreakNote streak={streak} where="home" />;
}
