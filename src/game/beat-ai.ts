// Beat the AI (#66): did the player get an image right before CLIP did (#56)?
// Owner: Darian. Pure and framework-free: the game server counts it for the
// final screen, and the round screen shows the same rule.
//
// The rule, in one place:
// - You beat the AI on an image if you got it right at an earlier view than
//   the first view the AI got right (`aiSolvedLevel`).
// - The same view is a tie, not a win.
// - An image without an AI result (`aiSolvedLevel` null) doesn't count either
//   way: null means the AI never got it, but also that the solver hasn't run on
//   it yet, and those can't be told apart.
// The leaderboard's SQL (`beatAiCount` in src/db/leaderboard.ts, #62) counts
// the same way; change both together.

import type { BeatAiSummary, RevealLevel, RoundResult } from "./types.ts";

export type AiVerdict = "beat" | "tie" | "lost" | "no-ai";

/** How one finished round went against the AI. */
export function aiVerdict(result: Pick<RoundResult, "outcome" | "revealLevelReached">, aiSolvedLevel: RevealLevel | null): AiVerdict {
  if (aiSolvedLevel === null) return "no-ai";
  if (result.outcome !== "correct") return "lost";
  if (result.revealLevelReached < aiSolvedLevel) return "beat";
  return result.revealLevelReached === aiSolvedLevel ? "tie" : "lost";
}

/** Counts a game's rounds against the AI. `aiSolvedLevelOf` gives each puzzle's level (null: no AI result). */
export function beatAiSummary(
  results: readonly Pick<RoundResult, "puzzleId" | "outcome" | "revealLevelReached">[],
  aiSolvedLevelOf: (puzzleId: string) => RevealLevel | null,
): BeatAiSummary {
  const verdicts = results.map((r) => aiVerdict(r, aiSolvedLevelOf(r.puzzleId)));
  return { beaten: verdicts.filter((v) => v === "beat").length, played: verdicts.filter((v) => v !== "no-ai").length };
}
