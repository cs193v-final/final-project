"use client";
// The log-in and sign-up form (#53). The action runs on the server; this only
// shows the fields and the errors it returns.
import Link from "next/link";
import { useActionState, useId } from "react";

import type { AccountFormState } from "@/app/account/actions";
import { DEFAULT_NEXT } from "@/auth/next-path";
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN } from "@/auth/rules";

type Props = {
  mode: "login" | "register";
  action: (state: AccountFormState, formData: FormData) => Promise<AccountFormState>;
  /** Where to go after logging in (#134), already checked with `safeNextPath`. Home if left out. */
  next?: string;
};

const inputClass =
  "w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-base text-zinc-900 dark:border-zinc-500 dark:bg-zinc-900 dark:text-zinc-100";
const errorClass = "text-sm font-medium text-rose-700 dark:text-rose-400";

export function AccountForm({ mode, action, next = DEFAULT_NEXT }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = useId();
  const isRegister = mode === "register";
  const usernameError = state?.errors.username;
  const passwordError = state?.errors.password;
  const keepNext = next === DEFAULT_NEXT ? "" : `?next=${encodeURIComponent(next)}`;

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4" noValidate>
      {/* The server checks it again: anyone can post any value. */}
      {next !== DEFAULT_NEXT && <input type="hidden" name="next" value={next} />}
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
          aria-describedby={`${id}-username-hint`}
        />
        <p id={`${id}-username-hint`} className={usernameError ? errorClass : "text-sm text-zinc-600 dark:text-zinc-400"}>
          {usernameError ??
            (isRegister
              ? `${USERNAME_MIN}–${USERNAME_MAX} letters, numbers, _ or -. Not an email address.`
              : "")}
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
          aria-describedby={`${id}-password-hint`}
        />
        <p id={`${id}-password-hint`} className={passwordError ? errorClass : "text-sm text-zinc-600 dark:text-zinc-400"}>
          {passwordError ?? (isRegister ? `At least ${PASSWORD_MIN} characters. There's no password reset yet.` : "")}
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
          href={`${isRegister ? "/login" : "/register"}${keepNext}`}
          className="font-medium underline underline-offset-2"
        >
          {isRegister ? "Log in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
