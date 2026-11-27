import type { DailyCredits } from "@/game/credits";
import type { Puzzle } from "@/game/types";

import { SectionHeading } from "./ui/controls";

/** "2026-12-02" → "Wed, Dec 2" (the date is already a Pacific day; formatted in UTC so it can't shift). */
function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** One photo's credit: who and where, the license, and a link to its page (https only). */
function Credit({ credit, n }: { credit: Puzzle["credit"]; n: number }) {
  const link = credit.url && /^https:\/\//u.test(credit.url) ? credit.url : null;
  return (
    <li className="flex flex-col gap-0.5 rounded-lg bg-zinc-100 px-4 py-3 text-left dark:bg-zinc-900">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">Photo {n}</span>
      <span>{credit.source}</span>
      <span className="text-sm text-zinc-700 dark:text-zinc-300">
        {credit.license}
        {link && (
          <>
            {" · "}
            <a href={link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              Photo page
            </a>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * The credits page's list (#239): the practice photos, then each past daily,
 * newest first. Today's and future dailies never reach it (src/db/credits.ts).
 */
export function CreditsList({ practice, dailies }: { practice: Puzzle["credit"][]; dailies: DailyCredits[] }) {
  return (
    <div className="flex w-full max-w-md flex-col gap-8">
      <section aria-labelledby="credits-practice">
        <SectionHeading id="credits-practice">Practice</SectionHeading>
        <ol className="flex flex-col gap-2">
          {practice.map((credit, i) => (
            <Credit key={i} credit={credit} n={i + 1} />
          ))}
        </ol>
      </section>
      {dailies.map((day) => (
        <section key={day.date} aria-labelledby={`credits-${day.date}`}>
          <SectionHeading id={`credits-${day.date}`}>
            {dayLabel(day.date)}: {day.title}
          </SectionHeading>
          <ol className="flex flex-col gap-2">
            {day.credits.map((credit, i) => (
              <Credit key={i} credit={credit} n={i + 1} />
            ))}
          </ol>
        </section>
      ))}
      {dailies.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">Daily photos are credited here the day after they&apos;re played.</p>
      )}
    </div>
  );
}
