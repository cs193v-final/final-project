"use client";

import type { ButtonHTMLAttributes } from "react";
import { buttonClass, type ButtonVariant } from "./styles";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  /** `primary` is the screen's main action (one per screen), `secondary` a normal one, `quiet` a minor one (e.g. Skip). */
  variant?: ButtonVariant;
  /**
   * Marks the button `aria-disabled` and ignores clicks and form submits, but
   * keeps it focusable, so keyboard focus doesn't jump away while, say, a move
   * is on its way to the server (as in #54 and #48).
   */
  disabled?: boolean;
};

/** An action on this screen (#89). Navigation that looks like a button is `ButtonLink`. */
export function Button({ variant = "primary", disabled = false, type = "button", className, onClick, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={disabled || undefined}
      className={buttonClass(variant, className)}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault(); // also stops a submit button from submitting its form
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
