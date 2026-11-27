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

/** `lg`: the screen's one main action (Play today's, Start round, Play again), in the display face (#183). */
export type ButtonSize = "md" | "lg";
const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: "",
  lg: "min-h-14 px-6 font-display text-lg tracking-tight",
};

/** The classes for a button-styled control, for the rare element that can't use `Button` or `ButtonLink`. */
export function buttonClass(variant: ButtonVariant = "primary", className?: string, size: ButtonSize = "md"): string {
  return joinClasses(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

/*
 * One recipe per surface (#183), so screens stop inventing their own. The
 * "toy block" look: Oat Paper, a plum-lavender edge and a solid base under it.
 */

/** A card: forms, result cards, the leaderboard, the streak note. Add your own padding. */
export const CARD =
  "rounded-xl border border-bevel bg-paper shadow-[0_4px_0_var(--color-bevel)] dark:border-zinc-500 dark:bg-zinc-800 dark:shadow-[0_4px_0_var(--color-zinc-950)]";

/** A row inside a list on the page (final-score rows, stats rows): a lighter base than a card. */
export const CARD_ROW =
  "rounded-lg border border-zinc-300 bg-paper shadow-[0_3px_0_var(--color-zinc-300)] dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-[0_3px_0_var(--color-zinc-950)]";

/** An empty or not-yet state ("Coming soon", "Nobody has finished yet"): dashed, no base. */
export const CARD_EMPTY = "rounded-xl border border-dashed border-zinc-500 dark:border-zinc-400";

/** Small labels on the page: "5 IMAGES · MIDNIGHT PT", "NEXT DAILY". */
export const CAPS_LABEL = "font-mono text-xs font-bold tracking-wider uppercase text-zinc-600 dark:text-zinc-300";

/** Every page's `h1` (and a screen's main `h2`), in the display face. */
export const PAGE_TITLE = "font-display text-4xl tracking-[-0.04em] text-balance";

export type ChipTone = "meadow" | "flash" | "peach" | "paper";
const CHIP_TONES: Record<ChipTone, string> = {
  meadow: "border-meadow-edge bg-meadow text-plum shadow-[0_2px_0_var(--color-meadow-shadow)]",
  flash: "border-flash-edge bg-flash text-plum shadow-[0_2px_0_var(--color-flash-shadow)]",
  peach: "border-[#a3413b] bg-peach text-[#6d2329] shadow-[0_2px_0_#a3413b]",
  paper:
    "border-bevel bg-paper text-zinc-700 shadow-[0_2px_0_var(--color-bevel)] dark:border-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-[0_2px_0_var(--color-zinc-950)]",
};

/** A small beveled label: the streak, the speed badge, the rating, the AI verdict, notices. */
export function chipClass(tone: ChipTone, className?: string): string {
  return joinClasses("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-bold", CHIP_TONES[tone], className);
}
