import Link from "next/link";
import type { ReactNode } from "react";

import type { DailyResetConfig } from "@/game/daily-date";

/** What the intro may show: the same shape as `DailyIntro` in `@/db/daily`, with no puzzle data. */
export type DailyIntroData = {
  date: string; // "YYYY-MM-DD"
  pack: { title: string; theme: string; puzzleCount: number } | null;
};

/** "Friday, November 20" for "2026-11-20". The date is already a calendar day, so format it in UTC. */
export function formatDailyDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "midnight Pacific time", "6:00 UTC", ... for the line saying when the next challenge starts. */
export function resetLabel({ timeZone, resetHour }: Readonly<DailyResetConfig>): string {
  const zone = timeZone === "America/Los_Angeles" ? "Pacific time" : timeZone;
  return `${resetHour === 0 ? "midnight" : `${resetHour}:00`} ${zone}`;
}

/**
 * The daily challenge's first screen (#58): today's theme before the first
 * image (decided: shown up front), how many images, and that the first game is
 * the one that counts (decided: one game per player per day). `start` is the
 * Start button, which needs server games (#54); without it the screen says so.
 */
export function DailyIntro({
  intro,
  reset,
  start,
}: {
  intro: DailyIntroData;
  reset: Readonly<DailyResetConfig>;
  start?: ReactNode;
}) {
  const day = formatDailyDate(intro.date);
  const next = `A new challenge starts at ${resetLabel(reset)}.`;

  if (intro.pack === null) {
    return (
      <section aria-labelledby="daily-heading" className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <p className="text-sm font-semibold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">{day}</p>
        <h2 id="daily-heading" className="text-2xl font-semibold">
          No daily challenge today
        </h2>
        <p className="text-zinc-700 dark:text-zinc-300">
          There isn&apos;t one scheduled for today. Try the practice images while you wait. {next}
        </p>
        <Link
          href="/play"
          className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Play practice
        </Link>
      </section>
    );
  }

  const { theme, puzzleCount } = intro.pack;
  return (
    <section aria-labelledby="daily-heading" className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <p className="text-sm font-semibold tracking-wide text-zinc-600 uppercase dark:text-zinc-400">{day}</p>
      <h2 id="daily-heading" className="text-4xl font-semibold tracking-tight">
        Today: {theme}
      </h2>
      <p className="text-lg text-zinc-700 dark:text-zinc-300">
        {puzzleCount} {puzzleCount === 1 ? "image" : "images"}, the same for everyone. You get one game, so make it count.
      </p>
      {start ?? (
        <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          Playing the daily arrives with server-side games.
        </p>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{next}</p>
    </section>
  );
}
