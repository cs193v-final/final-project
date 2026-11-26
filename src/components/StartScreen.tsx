import type { ReactNode } from "react";

import { TIMED_SCORING_CONFIG } from "@/game/scoring-config";
import type { TimedScoringConfig } from "@/game/types";
import { GAME_NAME } from "@/site";
import { ModePicker } from "./ModePicker";
import { PrototypeNotice, SectionHeading, TextLink } from "./ui/controls";

const pts = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "point" : "points"}`;

/**
 * The how-to-play steps, in order: timed rounds (#255). Points are explained
 * here, once, with the values from the scoring config (#64), instead of on
 * every round (#146, from user test #90). A plain version until the round
 * screen's own wording (#256).
 */
export function howToPlay(config: TimedScoringConfig = TIMED_SCORING_CONFIG): readonly string[] {
  return [
    "Press Start round: the photo appears, hidden at first, and clears up as the clock runs.",
    `Type what you think it is. Right away, a correct guess scores ${pts(config.maxPoints)}; the score drops the longer you take.`,
    `Once the photo is clear (${config.revealSeconds} seconds), a correct guess still scores ${pts(config.minPoints)}.`,
    `After ${config.limitSeconds} seconds the round ends with 0. Wrong guesses cost nothing.`,
  ];
}

export const HOW_TO_PLAY = howToPlay();

/**
 * Start screen (#18), now the home screen (#50): the game name, the modes to
 * choose from, and how to play. `streak` is the logged-in player's daily
 * streak (#63), which the page streams in; nothing when logged out.
 *
 * `scoring` is the config "How to play" explains: the practice pack's, with
 * its stored override if it has one (#204), so the numbers match the game.
 * The page reads it on the server; this component doesn't.
 */
export function StartScreen({ scoring = TIMED_SCORING_CONFIG, streak }: { scoring?: TimedScoringConfig; streak?: ReactNode } = {}) {
  const steps = howToPlay(scoring);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-5xl font-semibold tracking-tight">{GAME_NAME}</h1>
        {/* Short on purpose: a tester found the longer version too wordy (#144, user test #90). */}
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">Guess the picture. The less you see, the more you score.</p>
      </div>

      {streak}
      <ModePicker />
      {/* Not a mode, so not a card (#62). The header links to it too. */}
      <p className="-mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        <TextLink href="/leaderboard">See today&apos;s leaderboard</TextLink>
      </p>

      <section aria-labelledby="how-to-play" className="w-full max-w-md text-left">
        <SectionHeading id="how-to-play">How to play</SectionHeading>
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
              <span aria-hidden="true" className="font-semibold text-zinc-600 dark:text-zinc-400">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <PrototypeNotice>Prototype: point values are still being tuned.</PrototypeNotice>
    </main>
  );
}
