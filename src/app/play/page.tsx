import type { Metadata } from "next";
import { PracticeGame } from "@/components/game/PracticeGame";
import { SAMPLE_PUZZLES } from "@/puzzles";

export const metadata: Metadata = {
  title: "Practice · Zoom Out",
};

export default function PlayPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Practice</h1>
      <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
        Prototype: point values are still being tuned.
      </p>
      <PracticeGame puzzles={SAMPLE_PUZZLES} />
    </main>
  );
}
