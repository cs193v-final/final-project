import { StartScreen } from "@/components/StartScreen";
import { loadPracticeScoring } from "@/server/practice-scoring";

/**
 * The home page. "How to play" uses the practice pack's scoring (#204), a
 * cached read that's part of the prerendered page, not a query per request.
 */
export default async function Home() {
  return <StartScreen scoring={await loadPracticeScoring()} />;
}
