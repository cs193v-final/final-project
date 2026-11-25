import { aiVerdict } from "@/game/beat-ai";
import type { PublicRound, RoundResult } from "@/game/types";

/**
 * Beat the AI on the round screen (#66): while playing, the zoom level the AI
 * got this image at, as a target; once the round is over, how the player did
 * against it. Text only, never colour alone, and it names a zoom level (in the
 * caption's words, "Zoom level 1 of 5"), never the answer. Nothing when the AI
 * has no result for the image.
 */
export function AiBadge({
  round,
  result,
}: {
  round: Pick<PublicRound, "state" | "aiSolvedLevel" | "levelCount">;
  /** This round's result, once it has ended. */
  result?: Pick<RoundResult, "outcome" | "revealLevelReached"> | undefined;
}) {
  const { aiSolvedLevel, levelCount } = round;
  if (aiSolvedLevel === null) return null;
  const level = `zoom level ${aiSolvedLevel + 1}`;

  let text: string;
  if (round.state === "playing" || result === undefined) {
    text = `The AI got this at ${level} of ${levelCount}. Can you beat it?`;
  } else {
    switch (aiVerdict(result, aiSolvedLevel)) {
      case "beat":
        text = `You beat the AI! It needed ${level}.`;
        break;
      case "tie":
        text = `A tie: the AI got it at ${level} too.`;
        break;
      default:
        text = result.outcome === "correct" ? `The AI got this one first, at ${level}.` : `The AI got it at ${level}.`;
    }
  }
  return (
    <p data-ai-badge className="rounded-full border border-zinc-400 px-3 py-1 text-center text-sm text-zinc-700 dark:border-zinc-500 dark:text-zinc-300">
      {text}
    </p>
  );
}
