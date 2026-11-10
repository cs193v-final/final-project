import type { Round } from "@/game/round";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { pointsIfCorrect } from "@/game/scoring";
import type { RoundResult, ScoringConfig } from "@/game/types";

const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/** Top row while playing: which image this is and the running total (#16). */
export function ScoreHeader({ index, count, total }: { index: number; count: number; total: number }) {
  return (
    <div className="flex w-full max-w-md items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
      <span>
        Image {index + 1} of {count}
      </span>
      <span>
        Score <strong className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{total}</strong>
      </span>
    </div>
  );
}

/**
 * What the current image is worth (#16). While playing: points for a correct
 * answer right now, and what a zoom-out would drop it to, so players see the
 * trade-off before clicking. After the round: what it earned.
 */
export function RoundValue({
  round,
  result,
  config = SCORING_CONFIG,
}: {
  round: Pick<Round, "state" | "revealLevel" | "maxRevealLevel" | "wrongGuesses">;
  /** This round's result, once it has ended. */
  result?: RoundResult | undefined;
  config?: ScoringConfig;
}) {
  if (round.state !== "playing") {
    const points = result?.points ?? 0;
    return (
      <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
        +{pts(points)} for this image
      </p>
    );
  }

  const now = pointsIfCorrect(round.revealLevel, round.wrongGuesses, config);
  const afterZoom = pointsIfCorrect(round.revealLevel + 1, round.wrongGuesses, config);
  const canZoom = round.revealLevel < round.maxRevealLevel;
  return (
    <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
      Worth <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{pts(now)}</strong> now
      {canZoom && afterZoom < now ? ` · ${afterZoom} if you zoom out` : ""}
    </p>
  );
}
