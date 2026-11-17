"use server";
// Register, log in and log out (#53). Server Actions are reachable by direct
// POST, so each one validates its own input; Next.js also checks the Origin
// header, which blocks cross-site posts.
import { redirect } from "next/navigation";

import { login, register, type AuthResult, type FieldErrors } from "@/auth/accounts";
import { safeNextPath, withWelcome } from "@/auth/next-path";
import { describeError, endSession, requestIp, setSessionCookie } from "@/auth/session";
import { EncryptionKeyError } from "@/crypto/vault";
import { getDb } from "@/db";

/** What the forms show after a failed submit. Never echoes the password. */
export type AccountFormState = { username: string; errors: FieldErrors; message?: string } | undefined;

async function finish(kind: "register" | "login", result: AuthResult, formData: FormData): Promise<AccountFormState> {
  if (result.ok) {
    // Back to where you were going (`/login?next=/account`, #134) if that's a
    // page on this site, else the home screen, where most sites send you
    // (user test, #132). `?welcome=` makes the header say "Logged in as …"
    // once, for screen readers too.
    redirect(withWelcome(safeNextPath(formData.get("next")), kind === "register" ? "signup" : "login"));
  }
  const username = typeof formData.get("username") === "string" ? String(formData.get("username")) : "";
  if (result.reason === "invalid" || result.reason === "taken") return { username, errors: result.errors };
  return { username, errors: {}, message: result.message };
}

const UNAVAILABLE = "Something went wrong on our side. Please try again in a moment.";

/**
 * Runs register or login. If the database fails, including while setting the
 * session cookie (which ends any earlier session), the form shows a short
 * message instead of an error page, and the log gets only the error's type
 * (or, for a missing encryption key, its message, which says how to fix it):
 * Next would otherwise log the failed query with its parameters (the username
 * and the password hash).
 */
async function attempt(
  kind: "register" | "login",
  formData: FormData,
  run: typeof register | typeof login,
): Promise<AccountFormState> {
  const input = { username: formData.get("username"), password: formData.get("password") };
  let result: AuthResult;
  try {
    result = await run(getDb, input, { ip: await requestIp(), now: new Date() });
    if (result.ok) await setSessionCookie(result.session.token, result.session.expiresAt);
  } catch (error) {
    // A missing or malformed DATA_ENCRYPTION_KEY: its message never includes
    // the key and says how to fix it. Anything else gets only its type.
    const detail = error instanceof EncryptionKeyError ? `${error.name}: ${error.message}` : describeError(error);
    console.error(`${kind} failed: ${detail}`);
    const username = typeof input.username === "string" ? input.username : "";
    return { username, errors: {}, message: UNAVAILABLE };
  }
  // Outside the try: on success, finish() redirects, which works by throwing.
  return finish(kind, result, formData);
}

export async function registerAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  return attempt("register", formData, register);
}

export async function loginAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  return attempt("login", formData, login);
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
