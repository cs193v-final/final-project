import type { ReactNode } from "react";

import { CropMark, MONITOR, MONITOR_EMPTY, MONITOR_FRAME } from "@/components/game/monitor";
import { ButtonLink, CAPS_LABEL, PAGE_TITLE, PrototypeNotice } from "@/components/ui/controls";

import type { DailyIntro } from "@/game/daily";
import { DEFAULT_DAILY_RESET, type DailyResetConfig } from "@/game/daily-date";

/** "Friday, November 20" for "2026-11-20". The date is already a calendar day, so format it in UTC. */
export function formatDailyDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "midnight Pacific Time", "6 PM Eastern Time", "6 AM Coordinated Universal Time": the zone's name, for any zone. */
export function resetLabel({ timeZone, resetHour }: Readonly<DailyResetConfig> = DEFAULT_DAILY_RESET, now = new Date()): string {
  const name = (style: "longGeneric" | "long") =>
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: style })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value;
  // "Pacific Time" for most zones; a zone with no generic name (UTC) gives
  // "GMT+00:00", so use its long name ("Coordinated Universal Time") instead.
  const generic = name("longGeneric");
  const zone = generic && !generic.startsWith("GMT") ? generic : (name("long") ?? timeZone);
  const hour =
    resetHour === 0
      ? "midnight"
      : resetHour === 12
        ? "noon"
        : new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, resetHour)));
  return `${hour} ${zone}`;
}

/**
 * The daily challenge's first screen (#58): today's theme before the first
 * image (decided: shown up front), how many images, and that the first game is
 * the one that counts (one daily game per logged-in player; an anonymous
 * player's limit is per browser and can't be enforced, see the brief). `start` is the
 * Start button, which needs server games (#54); without it the screen says so.
 */
export function DailyIntroScreen({ intro, start }: { intro: DailyIntro; start?: ReactNode }) {
  const day = formatDailyDate(intro.date);
  const next = `A new challenge starts at ${resetLabel()}.`;

  if (intro.pack === null) {
    return (
      <section aria-labelledby="daily-heading" className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <p className={CAPS_LABEL}>{day}</p>
        <h2 id="daily-heading" className={PAGE_TITLE}>
          No daily challenge today
        </h2>
        <p className="text-zinc-700 dark:text-zinc-300">
          There isn&apos;t one scheduled for today. Try the practice images while you wait. {next}
        </p>
        <ButtonLink href="/play">Play practice</ButtonLink>
      </section>
    );
  }

  const { theme, puzzleCount } = intro.pack;
  return (
    <section aria-labelledby="daily-heading" className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <p className={CAPS_LABEL}>{day}</p>
      <h2 id="daily-heading" className={PAGE_TITLE}>
        Today: {theme}
      </h2>
      {/* The monitor the photos play in, still empty. Decorative: the sentence below says how many images. */}
      <div aria-hidden="true" className={MONITOR}>
        <div className={`${MONITOR_FRAME} ${MONITOR_EMPTY}`}>
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <CropMark className="size-14" />
            <p className="text-sm">The photo appears when you start</p>
          </div>
        </div>
      </div>
      {/* One empty tile per image, like the final score's tiles. */}
      <div aria-hidden="true" className="flex flex-wrap justify-center gap-1.5">
        {Array.from({ length: puzzleCount }, (_, i) => (
          <span
            key={i}
            data-image-tile
            className="h-8 w-9 rounded-md border border-zinc-300 bg-paper shadow-[0_2px_0_var(--color-zinc-300)] dark:border-zinc-600 dark:bg-zinc-800 dark:shadow-[0_2px_0_var(--color-zinc-950)]"
          />
        ))}
      </div>
      <p className="text-lg text-zinc-700 dark:text-zinc-300">
        {puzzleCount} {puzzleCount === 1 ? "image" : "images"}, the same for everyone. Your first game is the one that counts.
      </p>
      {start ?? <PrototypeNotice>Playing the daily arrives with server-side games.</PrototypeNotice>}
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{next}</p>
    </section>
  );
}
