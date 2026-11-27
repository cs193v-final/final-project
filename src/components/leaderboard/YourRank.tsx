"use client";

import { CAPS, MONITOR } from "@/components/game/monitor";

/**
 * Your rank when the top list doesn't show you (#62), as a plum strip like the
 * timed round's live score (#183). The rank shows as it is: counting up to
 * it would read as dropping places. The strip is decorative; the sentence under
 * it says the same for screen readers, and `catchingUp` adds that the list
 * will catch up.
 */
export function YourRank({ rank, players, score, catchingUp }: { rank: number; players: number; score: number; catchingUp: boolean }) {
  const points = `${score} ${score === 1 ? "point" : "points"}`;
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden="true" data-your-rank className={`${MONITOR} flex items-end justify-between gap-3 px-4 py-3`}>
        <div className="flex flex-col items-start">
          <span className={CAPS}>Your rank</span>
          <span className="flex items-baseline gap-2">
            <span data-rank-count className="font-display text-5xl leading-none tracking-[-0.05em] text-meadow tabular-nums">
              {rank}
            </span>
            <span className={CAPS}>of {players}</span>
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className={CAPS}>Score</span>
          <span className="font-mono text-2xl font-bold tabular-nums">{score}</span>
        </div>
      </div>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        <span className="sr-only">
          Your rank: {rank} of {players}, with {points}.
        </span>
        {catchingUp ? " The list updates within a minute." : null}
      </p>
    </div>
  );
}
