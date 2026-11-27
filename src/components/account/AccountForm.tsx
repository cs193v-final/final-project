"use client";
// The log-in and sign-up form (#53). The action runs on the server; this only
// shows the fields and the errors it returns.
import { useActionState, useId } from "react";

import type { AccountFormState } from "@/app/account/actions";
import { DEFAULT_NEXT } from "@/auth/next-path";
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from "@/auth/rules";
import { Button, CARD, TextInput, TextLink } from "@/components/ui/controls";

export type AccountFormProps = {
  mode: "login" | "register";
  action: (state: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  /** Where to go after logging in (#134), already checked with `safeNextPath`. Home if left out. */
  next?: string;
};

// The shared controls (#89, #183), so these pages match the game's.
const inputClass = "w-full";
const errorClass = "text-sm font-medium text-rose-700 dark:text-rose-400";
// Field errors and hints take no space when empty (not the form's role="alert",
// which must stay rendered for screen readers to announce it).
const fieldErrorClass = `${errorClass} empty:hidden`;
const hintClass = "text-sm text-zinc-600 empty:hidden dark:text-zinc-400";

export function AccountForm({ mode, action, next = DEFAULT_NEXT }: AccountFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = useId();
  const isRegister = mode === "register";
  const usernameError = state?.errors.username;
  const passwordError = state?.errors.password;
  const keepNext = next === DEFAULT_NEXT ? "" : `?next=${encodeURIComponent(next)}`;

  return (
    <form action={formAction} className={`${CARD} flex w-full max-w-sm flex-col gap-4 p-5`} noValidate>
      {/* The server checks it again: anyone can post any value. */}
      {next !== DEFAULT_NEXT && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-username`} className="font-medium">
          Username
        </label>
        <TextInput
          id={`${id}-username`}
          name="username"
          className={inputClass}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state?.username ?? ""}
          aria-invalid={usernameError ? true : undefined}
          aria-describedby={`${id}-username-error ${id}-username-hint`}
        />
        {/* The error goes above the hint, not in place of it, so the rules stay in view for the next try (#133). */}
        <p id={`${id}-username-error`} className={fieldErrorClass}>
          {usernameError ?? ""}
        </p>
        <p id={`${id}-username-hint`} className={hintClass}>
          {isRegister ? `${USERNAME_MIN}–${USERNAME_MAX} letters a–z, numbers, _ or -, with no spaces. Not an email address.` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-password`} className="font-medium">
          Password
        </label>
        <TextInput
          id={`${id}-password`}
          name="password"
          type="password"
          className={inputClass}
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
          maxLength={PASSWORD_MAX}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={`${id}-password-error ${id}-password-hint`}
        />
        <p id={`${id}-password-error`} className={fieldErrorClass}>
          {passwordError ?? ""}
        </p>
        <p id={`${id}-password-hint`} className={hintClass}>
          {isRegister ? `At least ${PASSWORD_MIN} characters. There's no password reset yet.` : ""}
        </p>
      </div>

      <p role="alert" className={errorClass}>
        {state?.message ?? ""}
      </p>

      {/* aria-disabled while pending (Button), so focus stays on it and a second press doesn't submit again. */}
      <Button type="submit" disabled={pending}>
        {pending ? "Please wait…" : isRegister ? "Create account" : "Log in"}
      </Button>

      <p className="text-sm">
        {isRegister ? "Already have an account? " : "New here? "}
        <TextLink href={`${isRegister ? "/login" : "/register"}${keepNext}`}>{isRegister ? "Log in" : "Create an account"}</TextLink>
      </p>
    </form>
  );
}
