"use client";

import { useEffect, useState } from "react";
import type { Round } from "@/game/round";
import { SCORING_CONFIG } from "@/game/scoring-config";
import { pointsIfCorrect } from "@/game/scoring";
import type { RoundResult, ScoringConfig } from "@/game/types";
import { CAPS_LABEL, chipClass } from "../ui/styles";
import { PENALTY_DROP, PENALTY_DROP_MS, PENALTY_DROP_TIMING, useTickDown } from "./live-motion";
import { CAPS } from "./monitor";
import { PULSE, PULSE_TIMING, useAnimateOn, usePrefersReducedMotion } from "./motion";

const pts = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/**
 * Top row while playing: which image this is and the running total (#16), in
 * the mono caps of the timed round's header (#183). With `outcomes`, a tile
 * per image too: done ones in Meadow (right) or Peach (skipped), this one
 * raised. The tiles are decorative: "Image 2 of 5" says where you are.
 */
export function ScoreHeader({
  index,
  count,
  total,
  outcomes,
}: {
  index: number;
  count: number;
  total: number;
  /** The finished images' outcomes so far, in order (`GameView.results`). */
  outcomes?: readonly RoundResult["outcome"][] | undefined;
}) {
  return (
    <div className="flex w-full max-w-md flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="flex items-center gap-2.5">
        <span className={CAPS_LABEL}>
          Image {index + 1} of {count}
        </span>
        {outcomes ? <ImagePips count={count} current={index} outcomes={outcomes} /> : null}
      </div>
      <span className={CAPS_LABEL}>
        Score{" "}
        <strong className="font-mono text-base text-zinc-900 tabular-nums dark:text-zinc-50">{total}</strong>
      </span>
    </div>
  );
}

function ImagePips({
  count,
  current,
  outcomes,
}: {
  count: number;
  current: number;
  outcomes: readonly RoundResult["outcome"][];
}) {
  return (
    <span aria-hidden="true" className="flex gap-1">
      {Array.from({ length: count }, (_, i) => {
        const outcome = outcomes[i];
        const tone =
          outcome === "correct"
            ? "border-meadow-edge bg-meadow-soft"
            : outcome === "skipped"
              ? "border-[#a3413b] bg-peach"
              : i === current
                ? "border-meadow-edge bg-meadow shadow-[0_2px_0_var(--color-meadow-edge)]"
                : "border-bevel bg-paper shadow-[0_2px_0_var(--color-bevel)] dark:bg-zinc-800";
        return <span key={i} data-image-pip={outcome ?? (i === current ? "current" : "next")} className={`size-3.5 rounded-[4px] border ${tone}`} />;
      })}
    </span>
  );
}

/**
 * The worth number's colour by how much is left (#183), as in the timed
 * round: Meadow while most of the points are there, Flash as they go, Peach
 * near the floor. On the deep-plum monitor all three are above 8:1, and the
 * number itself says the same, so colour is never the only signal.
 */
export function worthTone(points: number, config: ScoringConfig): string {
  const span = config.basePoints - config.minPoints;
  const share = span > 0 ? (points - config.minPoints) / span : 0;
  if (share >= 0.5) return "text-meadow";
  if (share >= 0.15) return "text-flash";
  return "text-peach";
}

/**
 * What the current image is worth (#16). While playing: points for a correct
 * answer right now, as the monitor's big number (#183). How zooming and wrong
 * guesses change that is explained once in How to play, not on every round
 * (#146, from user test #90); a "−20" chip drops off the number as it happens.
 * After the round: what it earned. Give it a key per image.
 */
export function RoundValue({
  round,
  result,
  pointsNow,
  config = SCORING_CONFIG,
}: {
  round: Pick<Round, "state" | "revealLevel" | "wrongGuesses">;
  /** This round's result, once it has ended. */
  result?: RoundResult | undefined;
  /** What a correct answer is worth now, as the server worked it out (`PublicRound.pointsAvailable`). */
  pointsNow?: number | undefined;
  /** The game's own values (`GameView.scoring`, #174): the colour scale, the chip, and the fallback when `pointsNow` isn't given. */
  config?: ScoringConfig;
}) {
  if (round.state !== "playing") {
    const points = result?.points ?? 0;
    return (
      <p className="text-center text-zinc-700 dark:text-zinc-300">
        <strong className="font-display text-xl tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
          +{pts(points)}
        </strong>{" "}
        for this image
      </p>
    );
  }

  const now = pointsNow ?? pointsIfCorrect(round.revealLevel, round.wrongGuesses, config);
  return <WorthNow now={now} revealLevel={round.revealLevel} wrongGuesses={round.wrongGuesses} config={config} />;
}

type Drop = { id: number; amount: number };

/**
 * The monitor's "worth now" gauge: the number ticks down to each new value
 * with one pulse, and the penalty that cost it drops off beside it. Only for
 * moves made while it's on screen: a round resumed after a refresh starts
 * still. Not a live region; the guess panel announces what happened.
 */
function WorthNow({
  now,
  revealLevel,
  wrongGuesses,
  config,
}: {
  now: number;
  revealLevel: number;
  wrongGuesses: number;
  config: ScoringConfig;
}) {
  const shown = useTickDown(now);
  const reduced = usePrefersReducedMotion();

  // What the last render saw, so each new zoom-out or wrong guess is noticed once.
  const [seen, setSeen] = useState({ now, revealLevel, wrongGuesses, drops: 0, drop: null as Drop | null });
  if (seen.now !== now || seen.revealLevel !== revealLevel || seen.wrongGuesses !== wrongGuesses) {
    const penalty =
      Math.max(0, revealLevel - seen.revealLevel) * config.revealPenalty +
      Math.max(0, wrongGuesses - seen.wrongGuesses) * config.wrongGuessPenalty;
    // The config's penalty, but never more than the number actually fell (the floor).
    const amount = Math.min(penalty, seen.now - now);
    const drops = amount > 0 ? seen.drops + 1 : seen.drops;
    setSeen({ now, revealLevel, wrongGuesses, drops, drop: amount > 0 ? { id: drops, amount } : seen.drop });
  }

  // The chip leaves once its drop has played.
  const dropId = seen.drop?.id ?? null;
  useEffect(() => {
    if (dropId === null) return;
    const timer = setTimeout(() => setSeen((s) => (s.drop?.id === dropId ? { ...s, drop: null } : s)), PENALTY_DROP_MS);
    return () => clearTimeout(timer);
  }, [dropId]);

  const number = useAnimateOn<HTMLElement>(seen.drops > 0 ? seen.drops : null, PULSE, PULSE_TIMING);

  return (
    <p data-worth-now className={`relative flex flex-col items-start ${CAPS}`}>
      Worth{" "}
      <strong
        ref={number}
        data-worth-points
        className={`inline-block font-display text-4xl leading-tight tracking-[-0.05em] normal-case tabular-nums transition-colors duration-300 sm:text-5xl ${worthTone(shown, config)}`}
      >
        {shown}
      </strong>{" "}
      {now === 1 ? "point" : "points"} now
      {seen.drop !== null && !reduced ? <PenaltyChip key={seen.drop.id} amount={seen.drop.amount} /> : null}
    </p>
  );
}

/** "−20", dropping off the worth number. Decorative: the number and the guess panel say it. */
function PenaltyChip({ amount }: { amount: number }) {
  const chip = useAnimateOn<HTMLSpanElement>("drop", PENALTY_DROP, PENALTY_DROP_TIMING);
  return (
    <span
      ref={chip}
      data-penalty-chip
      aria-hidden="true"
      className={chipClass("peach", "pointer-events-none absolute top-5 left-full z-10 ml-2 font-mono tracking-normal normal-case tabular-nums sm:top-6")}
    >
      −{amount}
    </span>
  );
}
