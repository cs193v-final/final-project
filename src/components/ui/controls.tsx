import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { buttonClass, FOCUS_RING, joinClasses, TEXT_INPUT, type ButtonVariant } from "./styles";

/**
 * Shared controls (#89), so similar controls look and behave the same on every
 * screen (Nielsen's "consistency and standards"). Use these instead of copying
 * class lists:
 * - `Button`: an action on this screen. `primary` is the screen's main action
 *   (one per screen), `secondary` a normal one, `quiet` a minor one (e.g. Skip).
 * - `ButtonLink`: navigation that looks like a button, e.g. "Start practice".
 * - `TextLink`: a standalone text link, e.g. "← Home".
 * - `TextInput`: a text box, e.g. the guess box or a username field. Give it a `<label>`.
 * - `SectionHeading`: the small heading above a group ("Choose a mode").
 * - `PrototypeNotice`: labels placeholder or sample data, as the course asks.
 *
 * Every control has the same visible keyboard focus (WCAG 2.4.7) and is at
 * least 24 × 24 px (WCAG 2.2, 2.5.8 Target Size).
 */

export { Button, type ButtonProps } from "./Button";
export { buttonClass, FOCUS_RING, type ButtonVariant } from "./styles";

export type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant };

export function ButtonLink({ variant = "primary", className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={buttonClass(variant, className)} />;
}

export function TextLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      className={joinClasses(
        // min-h-6 is 24 px, WCAG 2.2's minimum target (2.5.8).
        `inline-flex min-h-6 items-center rounded-sm text-sm font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white ${FOCUS_RING}`,
        className,
      )}
    />
  );
}

/**
 * A text box. It's an `<input>`: pass `id` and pair it with a `<label htmlFor>`.
 * Defaults to `type="text"`. Takes a `ref`, like `Button`, e.g. to focus it on an error.
 */
export function TextInput({ className, type = "text", ...rest }: ComponentProps<"input">) {
  return <input {...rest} type={type} className={joinClasses(TEXT_INPUT, className)} />;
}

/** A section's small heading. Give the section `aria-labelledby={id}` so screen readers name it. */
export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mb-3 text-center text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
      {children}
    </h2>
  );
}

/** Labels anything that's still a placeholder or sample data, e.g. "Prototype: 3 practice images." */
export function PrototypeNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
      {children}
    </p>
  );
}
