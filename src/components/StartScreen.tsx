import { GAME_NAME } from "@/site";
import { ModePicker } from "./ModePicker";
import { PrototypeNotice, SectionHeading } from "./ui/controls";

/** The how-to-play steps, in order. Kept free of point values until scoring (#15) is settled. */
export const HOW_TO_PLAY = [
  "Each image starts zoomed way in.",
  "Type what you think it is. A correct guess ends the round.",
  "Stuck? Zoom out to see more, but every zoom costs points.",
  "Wrong guesses cost points too. You can skip to the next image.",
] as const;

/**
 * Start screen (#18), now the home screen (#50): the game name, the modes to
 * choose from (only Practice is playable so far), and how to play.
 */
export function StartScreen() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-5xl font-semibold tracking-tight">{GAME_NAME}</h1>
        {/* Short on purpose: a tester found the longer version too wordy (#144, user test #90). */}
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">Guess the picture. The less you see, the more you score.</p>
      </div>

      <ModePicker />
      {/* Not a mode, so not a card. TODO(#62): a real link, e.g. in the header. */}
      <p className="-mt-4 text-sm text-zinc-600 dark:text-zinc-400">Coming soon: a daily leaderboard.</p>

      <section aria-labelledby="how-to-play" className="w-full max-w-md text-left">
        <SectionHeading id="how-to-play">How to play</SectionHeading>
        <ol className="flex flex-col gap-2">
          {HOW_TO_PLAY.map((step, i) => (
            <li key={step} className="flex gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
              <span aria-hidden="true" className="font-semibold text-zinc-600 dark:text-zinc-400">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <PrototypeNotice>Prototype: 3 practice images. Daily puzzles aren&apos;t built yet.</PrototypeNotice>
    </main>
  );
}
