import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RoundPreview, type PreviewPhoto } from "@/components/game/RoundPreview";
import samplePuzzles from "@/puzzles/sample.json";
import { parsePuzzles } from "@/game/puzzles";
import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import { checkPreviewGuess, previewAnswer } from "./actions";

export const metadata: Metadata = {
  title: "Round preview (dev) · Zoom Out",
  robots: { index: false },
};

/**
 * Development only (#256): plays the timed round screen with the practice
 * pack, so the screen can be tried before the timed server (#255) lands. The
 * browser keeps the clock; guesses are checked by Server Actions, so answers
 * stay on the server as in the real game. 404 in every production build,
 * including Vercel previews. Remove once the real games use `TimedRound`.
 */
export default function RoundPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const photos: PreviewPhoto[] = parsePuzzles(samplePuzzles).map((p) => ({
    seed: p.id,
    imageUrl: p.imageUrl,
    focus: p.reveal.focus,
    credit: p.credit,
    effect: p.effect,
  }));
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Round preview (dev only)</h1>
      <RoundPreview photos={photos} scoring={TIMED_SCORING_CONFIG} check={checkPreviewGuess} answer={previewAnswer} />
    </main>
  );
}
