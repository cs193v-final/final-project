"use client";
// The log-in and sign-up form (#53). The action runs on the server; this only
// shows the fields and the errors it returns.
import Link from "next/link";
import { useActionState, useId } from "react";

import type { AccountFormState } from "@/app/account/actions";
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from "@/auth/rules";

type Props = {
  mode: "login" | "register";
  action: (state: AccountFormState, formData: FormData) => Promise<AccountFormState>;
};

const inputClass =
  "w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-base text-zinc-900 dark:border-zinc-500 dark:bg-zinc-900 dark:text-zinc-100";
const errorClass = "text-sm font-medium text-rose-700 dark:text-rose-400";
// Field errors and hints take no space when empty (not the form's role="alert",
// which must stay rendered for screen readers to announce it).
const fieldErrorClass = `${errorClass} empty:hidden`;
const hintClass = "text-sm text-zinc-600 empty:hidden dark:text-zinc-400";

export function AccountForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = useId();
  const isRegister = mode === "register";
  const usernameError = state?.errors.username;
  const passwordError = state?.errors.password;

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-username`} className="font-medium">
          Username
        </label>
        <input
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
          {isRegister ? `${USERNAME_MIN}–${USERNAME_MAX} letters, numbers, _ or -, with no spaces. Not an email address.` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-password`} className="font-medium">
          Password
        </label>
        <input
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

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {pending ? "Please wait…" : isRegister ? "Create account" : "Log in"}
      </button>

      <p className="text-sm">
        {isRegister ? "Already have an account? " : "New here? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-medium underline underline-offset-2"
        >
          {isRegister ? "Log in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
