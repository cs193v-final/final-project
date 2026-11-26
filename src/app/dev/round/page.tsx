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

/** The effects for the practice photos, as in #259, until `Puzzle.effect` merges. */
const EFFECTS: Record<string, string> = { "pz-dbdb4dee": "thermal", "pz-683182e7": "pixelate", "pz-af6d3bbb": "zoom" };

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
    imageUrl: p.imageUrl,
    focus: p.reveal.focus,
    credit: p.credit,
    effect: EFFECTS[p.id],
  }));
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Round preview (dev only)</h1>
      <RoundPreview photos={photos} scoring={TIMED_SCORING_CONFIG} check={checkPreviewGuess} answer={previewAnswer} />
    </main>
  );
}
