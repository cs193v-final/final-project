// PLACEHOLDER home page from the scaffold (#9). The start screen (#18) and the
// game screens (#10, #11, #14, #16) replace this.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
        Placeholder: the game isn&apos;t built yet
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">Zoom Out</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        A daily image-guessing game. Each image starts zoomed in. Guess what it is, or zoom out to
        see more. Every reveal costs points.
      </p>
    </main>
  );
}
