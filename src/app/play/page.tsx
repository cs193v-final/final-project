import type { Metadata } from "next";
import { PracticeGame } from "@/components/game/PracticeGame";
import { PLACEHOLDER_PUZZLES } from "./placeholder-puzzles";

export const metadata: Metadata = {
  title: "Practice · Zoom Out",
};

export default function PlayPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Practice</h1>
      <PracticeGame puzzles={PLACEHOLDER_PUZZLES} />
    </main>
  );
}
