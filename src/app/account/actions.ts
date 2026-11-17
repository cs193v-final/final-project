"use server";
// Register, log in and log out (#53). Server Actions are reachable by direct
// POST, so each one validates its own input; Next.js also checks the Origin
// header, which blocks cross-site posts.
import { redirect } from "next/navigation";

import { login, register, type AuthResult, type FieldErrors } from "@/auth/accounts";
import { describeError, endSession, requestIp, setSessionCookie } from "@/auth/session";
import { getDb } from "@/db";

/** What the forms show after a failed submit. Never echoes the password. */
export type AccountFormState = { username: string; errors: FieldErrors; message?: string } | undefined;

async function finish(result: AuthResult, formData: FormData): Promise<AccountFormState> {
  if (result.ok) {
    await setSessionCookie(result.session.token, result.session.expiresAt);
    // Back to the home screen, where most sites send you after logging in
    // (user test, #132). The header shows the username, so you can see it worked.
    redirect("/");
  }
  const username = typeof formData.get("username") === "string" ? String(formData.get("username")) : "";
  if (result.reason === "invalid" || result.reason === "taken") return { username, errors: result.errors };
  return { username, errors: {}, message: result.message };
}

const UNAVAILABLE = "Something went wrong on our side. Please try again in a moment.";

/**
 * Runs register or login. If the database fails, the form shows a short
 * message instead of an error page, and the log gets only the error's type:
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
  } catch (error) {
    console.error(`${kind} failed: ${describeError(error)}`);
    const username = typeof input.username === "string" ? input.username : "";
    return { username, errors: {}, message: UNAVAILABLE };
  }
  return finish(result, formData);
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
