// Shared control styles (#89). Plain strings, so both Server and Client
// Components can use them. See ./controls.tsx for which control to use when.

/** Visible keyboard focus, the same everywhere (WCAG 2.4.7). */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100";

export type ButtonVariant = "primary" | "secondary" | "quiet";

// min-h-10 (40 px) is well above WCAG 2.2's 24 × 24 px minimum target (2.5.8).
const BUTTON_BASE = `inline-flex min-h-10 items-center justify-center gap-2 rounded-lg py-2 font-medium ${FOCUS_RING} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-zinc-900 px-4 text-white hover:bg-zinc-700 aria-disabled:hover:bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:aria-disabled:hover:bg-zinc-100",
  secondary:
    "border border-zinc-300 bg-white px-4 text-zinc-900 hover:bg-zinc-100 aria-disabled:hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:aria-disabled:hover:bg-zinc-900",
  quiet: "px-3 text-zinc-700 underline-offset-4 hover:underline aria-disabled:hover:no-underline dark:text-zinc-300",
};

export const joinClasses = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(" ");

/** The classes for a button-styled control, for the rare element that can't use `Button` or `ButtonLink`. */
export function buttonClass(variant: ButtonVariant = "primary", className?: string): string {
  return joinClasses(BUTTON_BASE, BUTTON_VARIANTS[variant], className);
}
