import Link from "next/link";

/** The how-to-play steps, in order. Kept free of point values until scoring (#15) is settled. */
export const HOW_TO_PLAY = [
  "Each image starts zoomed way in.",
  "Type what you think it is. A correct guess ends the round.",
  "Stuck? Zoom out to see more, but every zoom costs points.",
  "Wrong guesses cost points too. You can skip to the next image.",
] as const;

/** Start screen (#18): the game name, how to play, and a Start button into `/play`. */
export function StartScreen() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-5xl font-semibold tracking-tight">Zoom Out</h1>
        <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
          Guess the picture from a tiny piece of it. The less you need to see, the more you score.
        </p>
      </div>

      <section aria-labelledby="how-to-play" className="w-full max-w-md text-left">
        <h2 id="how-to-play" className="mb-3 text-center text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          How to play
        </h2>
        <ol className="flex flex-col gap-2">
          {HOW_TO_PLAY.map((step, i) => (
            <li key={step} className="flex gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
              <span aria-hidden="true" className="font-semibold text-zinc-400">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-col items-center gap-3">
        <Link
          href="/play"
          className="rounded-lg bg-zinc-900 px-6 py-3 text-lg font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Start practice
        </Link>
        <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          Prototype: 3 practice images. Daily puzzles aren&apos;t built yet.
        </p>
      </div>
    </main>
  );
}
