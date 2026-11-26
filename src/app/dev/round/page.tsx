import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoundPreview } from "@/components/game/RoundPreview";
import samplePuzzles from "@/puzzles/sample.json";
import { parsePuzzles } from "@/game/puzzles";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";

export const metadata: Metadata = {
  title: "Round preview (dev) · Zoom Out",
  robots: { index: false },
};

/**
 * Development only (#256): plays the timed round screen with the practice
 * pack, faking the server in the browser, so the screen can be tried before
 * the timed server (#255) lands. 404 in every production build, including
 * Vercel previews. Remove once the real games use `TimedRound`.
 */
export default function RoundPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  // Only the practice pack, which is public in the repo anyway.
  const puzzles = parsePuzzles(samplePuzzles);
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Round preview (dev only)</h1>
      <RoundPreview puzzles={puzzles} scoring={TIMED_SCORING_CONFIG} />
    </main>
  );
}
