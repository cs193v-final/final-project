import type { ReactNode } from "react";
import { CropMark, MONITOR, MONITOR_EMPTY, MONITOR_FRAME } from "./game/monitor";
import { buttonClass, ButtonLink, PAGE_TITLE, type ButtonVariant } from "./ui/controls";

/** Where the error screens send players: home, and straight into practice, with the home screen's link text. */
export const RECOVERY_LINKS = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Start practice" },
] as const;

/** The words for an unexpected error, the same in `error.tsx` and `global-error.tsx`. */
export const UNEXPECTED_ERROR = {
  title: "Something went wrong",
  message: "Sorry, that page didn't load. Try again, or head back home.",
} as const;

/**
 * The 404 and error screens (#229): what happened, in plain words, and a way
 * back into the game ("help users recognize, diagnose and recover from
 * errors"). Never the error itself: its message or stack could show internal
 * details.
 */
export function ErrorScreen({
  title,
  message,
  action,
  reload = false,
}: {
  title: string;
  message: string;
  /** The screen's main action, e.g. "Try again". Without one, Home is the main action. */
  action?: ReactNode;
  /**
   * Plain links that load a whole new page, for `global-error.tsx`: it
   * replaces the root layout, so a fresh load runs the layout again instead of
   * navigating inside an app whose layout just failed.
   */
  reload?: boolean;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      {/* The game's monitor with nothing in it (#183): decoration, so screen readers skip it. */}
      <div aria-hidden="true" className={`${MONITOR} max-w-xs`}>
        <div className={`${MONITOR_FRAME} ${MONITOR_EMPTY}`}>
          <div className="flex flex-col items-center gap-3">
            <CropMark className="size-14" />
            {/* Not CAPS: its 11 px is under the 12 px floor e2e/a11y.spec.ts checks. */}
            <p className="font-mono text-xs font-bold tracking-[0.1em] uppercase">Nothing in frame</p>
          </div>
        </div>
      </div>
      <h1 className={PAGE_TITLE}>{title}</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">{message}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {action}
        {RECOVERY_LINKS.map(({ href, label }, i) => {
          const variant: ButtonVariant = action === undefined && i === 0 ? "primary" : "secondary";
          return reload ? (
            <a key={href} href={href} className={buttonClass(variant)}>
              {label}
            </a>
          ) : (
            <ButtonLink key={href} href={href} variant={variant}>
              {label}
            </ButtonLink>
          );
        })}
      </div>
    </main>
  );
}
