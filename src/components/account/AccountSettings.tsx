"use client";
// Change your password and delete your account (#234), on /account. The
// actions run on the server and act on the logged-in user; these forms only
// show the fields and what comes back. Same controls and error layout as the
// log-in form (AccountForm).
import { useActionState, useId, type ComponentProps, type ReactNode } from "react";

import type { DeleteFormState, PasswordFormState } from "@/app/account/actions";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/auth/rules";
import { Button, CARD, TextInput } from "@/components/ui/controls";

type PasswordAction = (state: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;
type DeleteAction = (state: DeleteFormState, formData: FormData) => Promise<DeleteFormState>;

// Rust, the palette's error colour (#183): 5.8:1 on paper, 7.3:1 on the dark card.
const errorClass = "text-sm font-medium text-rust";
const fieldErrorClass = `${errorClass} empty:hidden`;
const hintClass = "text-sm text-zinc-600 empty:hidden dark:text-zinc-400";
// Each section is a card (#183), titled in the display face at a section's size (PAGE_TITLE is the page's).
const sectionClass = `${CARD} flex w-full flex-col gap-4 p-5`;
const sectionTitle = "font-display text-2xl tracking-[-0.04em] text-balance";

/** A labelled text box with its error (above the hint, like AccountForm) and an optional hint. */
function Field({
  id,
  label,
  error,
  hint,
  ...input
}: { id: string; label: string; error?: string; hint?: ReactNode } & Omit<ComponentProps<"input">, "id">) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <TextInput
        id={id}
        className="w-full"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-error ${id}-hint`}
        {...input}
      />
      <p id={`${id}-error`} className={fieldErrorClass}>
        {error ?? ""}
      </p>
      <p id={`${id}-hint`} className={hintClass}>
        {hint ?? ""}
      </p>
    </div>
  );
}

export function ChangePasswordForm({ action }: { action: PasswordAction }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-heading`} className={sectionClass}>
      <h2 id={`${id}-heading`} className={sectionTitle}>
        Change your password
      </h2>
      {/* A new key after it worked, so the browser forgets what was typed. */}
      <form key={state?.done ? "done" : "form"} action={formAction} className="flex flex-col gap-4" noValidate>
        <Field
          id={`${id}-current`}
          label="Current password"
          name="current"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX}
          required
          error={state?.errors.current}
        />
        <Field
          id={`${id}-new`}
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX}
          required
          error={state?.errors.password}
          hint={`At least ${PASSWORD_MIN} characters. Other browsers will be logged out.`}
        />
        {/* Always rendered, so a screen reader announces what changes in it. */}
        <p role="status" className="text-sm font-medium empty:hidden">
          {state?.done ? "Password changed. Any other browsers have been logged out." : ""}
        </p>
        <p role="alert" className={errorClass}>
          {state?.message ?? ""}
        </p>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Please wait…" : "Change password"}
        </Button>
      </form>
    </section>
  );
}

export function DeleteAccountForm({ action, username }: { action: DeleteAction; username: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const id = useId();
  return (
    // Its own card with a rust edge, so it reads as the dangerous one; the button stays secondary.
    <section aria-labelledby={`${id}-heading`} className={`${sectionClass} border-l-4 border-l-rust dark:border-l-rust`}>
      <h2 id={`${id}-heading`} className={sectionTitle}>
        Delete your account
      </h2>
      <p id={`${id}-what`} className="text-sm">
        This deletes your account and every game you played while logged in, including your leaderboard entries. It can&apos;t
        be undone.
      </p>
      <form action={formAction} className="flex flex-col gap-4" aria-describedby={`${id}-what`} noValidate>
        <Field
          id={`${id}-current`}
          label="Current password"
          name="current"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX}
          required
          error={state?.errors.current}
        />
        <Field
          id={`${id}-confirm`}
          label="Type your username to confirm"
          name="confirm"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          error={state?.errors.confirm}
          hint={
            <>
              Your username is <strong>{username}</strong>.
            </>
          }
        />
        <p role="alert" className={errorClass}>
          {state?.message ?? ""}
        </p>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Please wait…" : "Delete my account"}
        </Button>
      </form>
    </section>
  );
}
