import type { ReactNode } from "react";
import { MODES, type GameMode } from "./modes";
import { ButtonLink } from "./ui/controls";
import { joinClasses } from "./ui/styles";

const isFeatured = (mode: GameMode) => mode.status === "available" && mode.featured === true;

/** The featured mode's button: the screen's one primary action, a size up (#145, #183). */
export const FEATURED_LINK_CLASS = "min-h-14 px-6 font-display text-lg tracking-tight";
/** The other modes' buttons. */
export const MODE_LINK_CLASS = "mt-auto self-stretch";

/** Each mode's picture-island icon (#183), by mode id. Decorative. */
const ICONS: Record<string, ReactNode> = {
  // A flask: practice is the lab.
  practice: <path d="M9 3h6m-5 0v7l-5 8a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-8V3M8 15h8" />,
  // Hoover Tower.
  stanford: <path d="M4 21h16M8 21V9l4-6 4 6v12M8 10h8m-4 3v3" />,
};

/**
 * Where each mode sits on a wide screen (#183): the daily in the middle under
 * the island, practice on the left, Stanford on the right. On a phone they
 * stack in list order, daily first. The list order (and so the tab order)
 * stays Daily, Stanford, Practice.
 */
const PLACE: Record<string, string> = {
  practice: "sm:col-start-1 sm:row-start-1",
  stanford: "sm:col-start-3 sm:row-start-1",
};

/**
 * The home screen's list of ways to play (#50). Available modes link to their
 * page. Modes that aren't built yet are listed but clearly marked "Coming
 * soon" in text, and aren't links, so keyboard users never tab onto a dead end.
 *
 * The featured mode (the daily, #145) comes first, sits in the middle, and has
 * the screen's one primary button; the others get secondary ones.
 */
export function ModePicker({ modes = MODES }: { modes?: readonly GameMode[] }) {
  return (
    <section aria-labelledby="choose-mode" className="w-full max-w-4xl">
      {/* The island and the buttons say what this is; the heading names the region for screen readers. */}
      <h2 id="choose-mode" className="sr-only">
        Choose a mode
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_minmax(16rem,1.4fr)_1fr] sm:items-stretch">
        {[...modes.filter(isFeatured), ...modes.filter((m) => !isFeatured(m))].map((mode) =>
          isFeatured(mode) ? (
            <li
              key={mode.id}
              className="rise-in flex flex-col items-center justify-end gap-2 pb-1 text-center [--rise-delay:120ms] sm:col-start-2 sm:row-start-1"
            >
              <p className="font-mono text-xs font-bold tracking-wider text-zinc-600 uppercase dark:text-zinc-300">
                5 images · Midnight PT
              </p>
              <h3 className="font-display text-2xl tracking-tight">{mode.title}</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">{mode.description}</p>
              {mode.status === "available" ? (
                <ButtonLink href={mode.href} variant="primary" className={FEATURED_LINK_CLASS}>
                  {mode.cta}
                  <Arrow />
                </ButtonLink>
              ) : null}
            </li>
          ) : (
            <li
              key={mode.id}
              className={joinClasses(
                "rise-in flex flex-col gap-2 rounded-xl border p-3 text-left sm:self-end",
                // After the daily, in list order (#183).
                mode.id === "stanford" ? "[--rise-delay:190ms]" : "[--rise-delay:260ms]",
                mode.status === "available"
                  ? "border-[#776795] bg-paper shadow-[0_4px_0_#776795] dark:border-zinc-400 dark:bg-zinc-800 dark:shadow-[0_4px_0_#b899cc]"
                  : "border-dashed border-zinc-500 dark:border-zinc-400",
                PLACE[mode.id],
              )}
            >
              <div className="flex items-center gap-2.5">
                {ICONS[mode.id] ? (
                  <span
                    aria-hidden="true"
                    className={joinClasses(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      mode.id === "stanford" ? "bg-[#ffcfb9] text-[#6d3027]" : "bg-[#ded0fc] text-[#392257]",
                    )}
                  >
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      {ICONS[mode.id]}
                    </svg>
                  </span>
                ) : null}
                <div className="min-w-0">
                  <h3 className="font-display text-base tracking-tight">{mode.title}</h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">{mode.description}</p>
                </div>
              </div>
              {mode.status === "available" ? (
                <ButtonLink href={mode.href} variant="secondary" className={MODE_LINK_CLASS}>
                  {mode.cta}
                  <Arrow />
                </ButtonLink>
              ) : (
                <p className="mt-auto self-start rounded-full bg-zinc-200 px-3 py-1 text-sm font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100">
                  Coming soon
                </p>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15m-5-5 5 5-5 5" />
    </svg>
  );
}
