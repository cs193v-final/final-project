// Shared control styles (#89), in the "Picture Island" look (#183). Plain
// strings, so both Server and Client Components can use them. See
// ./controls.tsx for which control to use when.

/** Visible keyboard focus, the same everywhere (WCAG 2.4.7): violet on lavender, meadow in the dark. */
export const FOCUS_RING =
  "focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus)]";

/**
 * `primary`: the screen's main action, in Meadow (one per screen).
 * `secondary`: a normal action on Oat Paper. `flash`: the Guess button, in
 * Peach Flash. `quiet`: a minor one (e.g. Skip).
 */
export type ButtonVariant = "primary" | "secondary" | "flash" | "quiet";

// min-h-11 (44 px) is well above WCAG 2.2's 24 × 24 px minimum target (2.5.8).
const BUTTON_BASE = `inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] py-2 font-semibold ${FOCUS_RING} aria-disabled:cursor-not-allowed aria-disabled:opacity-55`;

// `bevel` (globals.css) draws the block's base and sinks it on press. The
// borders need 3:1 against the page (WCAG 1.4.11): the bevel colours do.
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bevel border border-[#5a793a] bg-meadow px-5 text-plum [--bevel-color:#668446]",
  secondary:
    "bevel border border-[#776795] bg-paper px-5 text-plum dark:border-zinc-400 dark:bg-zinc-800 dark:text-zinc-50 dark:[--bevel-color:#b899cc]",
  flash: "bevel border border-[#955838] bg-flash px-5 text-plum [--bevel-color:#995c37]",
  quiet: "px-3 text-zinc-700 underline-offset-4 hover:underline aria-disabled:hover:no-underline dark:text-zinc-300",
};

export const joinClasses = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

/** A text box: the same height, border and focus ring as the buttons next to it (WCAG 1.4.11, 2.4.7). */
export const TEXT_INPUT = `min-h-11 rounded-[9px] border border-[#7e689a] bg-paper px-3 py-2 text-base text-plum placeholder:text-zinc-600 dark:border-zinc-400 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-300 ${FOCUS_RING}`;

/** The classes for a button-styled control, for the rare element that can't use `Button` or `ButtonLink`. */
export function buttonClass(variant: ButtonVariant = "primary", className?: string): string {
  return joinClasses(BUTTON_BASE, BUTTON_VARIANTS[variant], className);
}
