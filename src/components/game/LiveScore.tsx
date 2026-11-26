import { scoreAt } from "@/game/scoring";
import type { RoundResult, RoundState, TimedScoringConfig } from "@/game/types";

const pts = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "point" : "points"}`;

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
 * What the current image is worth (timed rounds, #255). Before the start:
 * what it starts at. While playing: `scoreAt` of the time so far, the same
 * function the server scores with, and the seconds left. After the round:
 * what it earned. A plain stand-in until the round screen (#256) replaces it.
 */
export function RoundValue({
  state,
  seconds,
  scoring,
  result,
}: {
  state: RoundState;
  /** The round's time now: the server's elapsed time, counted on in the browser. */
  seconds: number;
  scoring: TimedScoringConfig;
  /** This round's result, once it has ended. */
  result?: RoundResult | undefined;
}) {
  if (state === "ready") {
    return (
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Starts at <strong className="font-semibold text-zinc-900 dark:text-zinc-100">{pts(scoring.maxPoints)}</strong> and drops
        until you get it. {scoring.limitSeconds} seconds per image.
      </p>
    );
  }
  if (state !== "playing") {
    const points = result?.points ?? 0;
    return (
      <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
        +{pts(points)} for this image
      </p>
    );
  }
  // `seconds` starts a little below 0 (the server's network grace, #255): no more than the limit is left.
  const left = Math.min(scoring.limitSeconds, Math.max(0, Math.ceil(scoring.limitSeconds - seconds)));
  return (
    <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
      Worth <strong className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{pts(scoreAt(seconds, scoring))}</strong> now ·{" "}
      <span className="tabular-nums">{left} s left</span>
    </p>
  );
}
