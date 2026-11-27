"use server";
// Register, log in and log out (#53); change the password and delete the
// account (#234). Server Actions are reachable by direct
// POST, so each one validates its own input; Next.js also checks the Origin
// header, which blocks cross-site posts.
import { redirect } from "next/navigation";

import {
  changePassword,
  deleteAccount,
  login,
  register,
  type AuthResult,
  type ChangePasswordResult,
  type DeleteAccountErrors,
  type DeleteAccountResult,
  type FieldErrors,
  type PasswordChangeErrors,
} from "@/auth/accounts";
import { loginPath, safeNextPath, withWelcome } from "@/auth/next-path";
import {
  clearAccountCookies,
  discardSession,
  endSession,
  getCurrentUser,
  requestDeviceToken,
  requestIp,
  setDeviceCookie,
  setSessionCookie,
} from "@/auth/session";
import { getDb } from "@/db";
import { errorSummary } from "@/server/error-summary";

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
/** Sign-up worked but the cookie didn't: trying again would only say "taken". */
const CREATED_NOT_LOGGED_IN = "Your account was created, but we couldn't log you in. Please log in.";

/**
 * Runs register or login. If the database fails, the form shows a short
 * message instead of an error page, and the log gets the error by
 * `errorForLog`'s rule (`errorSummary`): names, Postgres codes and messages
 * that can't quote a value. Next would otherwise log the failed query with its
 * parameters (the username and the password hash).
 *
 * Setting the session cookie (which ends any earlier session) can fail after
 * the account and session already exist. Then the unused session is deleted,
 * and a sign-up says the account was created, so nobody retries into "That
 * username is taken" for an account they don't know they have.
 */
async function attempt(
  kind: "register" | "login",
  formData: FormData,
  run: typeof register | typeof login,
): Promise<AccountFormState> {
  const input = { username: formData.get("username"), password: formData.get("password") };
  const username = typeof input.username === "string" ? input.username : "";
  let result: AuthResult;
  const now = new Date();
  try {
    result = await run(getDb, input, { ip: await requestIp(), now, device: await requestDeviceToken() });
  } catch (error) {
    // A missing or malformed DATA_ENCRYPTION_KEY keeps its message, which
    // never includes the key and says how to fix it; a failed query keeps
    // only its names and Postgres code.
    console.error(`${kind} failed: ${errorSummary(error)}`);
    return { username, errors: {}, message: UNAVAILABLE };
  }
  if (result.ok) {
    try {
      await setSessionCookie(result.session.token, result.session.expiresAt);
    } catch (error) {
      console.error(`${kind} failed setting the session cookie: ${errorSummary(error)}`);
      await discardSession(result.session.token);
      return { username, errors: {}, message: kind === "register" ? CREATED_NOT_LOGGED_IN : UNAVAILABLE };
    }
    // Best effort (#151): without it, this browser is just treated like a new one next time.
    await setDeviceCookie(result.device, now).catch((error: unknown) => {
      console.error(`${kind}: couldn't set the device cookie: ${errorSummary(error)}`);
    });
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

// Changing the password and deleting the account (#234), from /account. Both
// act on the logged-in user (never a name from the form); a request without a
// session goes to the login page.

/** What the password form shows: field errors, a message, or that it worked. Never echoes a password. */
export type PasswordFormState = { errors: PasswordChangeErrors; message?: string; done?: boolean } | undefined;
/** What the delete form shows after a failed submit. On success it redirects instead. */
export type DeleteFormState = { errors: DeleteAccountErrors; message?: string } | undefined;

/** Changed, but the new session's cookie couldn't be set: every old session has already ended. */
const CHANGED_NOT_LOGGED_IN = "Your password was changed, but we couldn't keep you logged in. Please log in with your new password.";

/** The logged-in user's id, or `null` if the session lookup failed (logged). Redirects to log in if there's no session. */
async function accountUserId(kind: string): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    if (user) return user.id;
  } catch (error) {
    console.error(`${kind} failed: ${errorSummary(error)}`);
    return null;
  }
  redirect(loginPath("/account"));
}

export async function changePasswordAction(_prev: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const userId = await accountUserId("password change");
  if (!userId) return { errors: {}, message: UNAVAILABLE };
  const now = new Date();
  let result: ChangePasswordResult;
  try {
    result = await changePassword(getDb, userId, { current: formData.get("current"), password: formData.get("password") }, { ip: await requestIp(), now });
  } catch (error) {
    console.error(`password change failed: ${errorSummary(error)}`);
    return { errors: {}, message: UNAVAILABLE };
  }
  if (!result.ok) return result.reason === "invalid" ? { errors: result.errors } : { errors: {}, message: result.message };

  try {
    await setSessionCookie(result.session.token, result.session.expiresAt);
  } catch (error) {
    console.error(`password change failed setting the session cookie: ${errorSummary(error)}`);
    await discardSession(result.session.token);
    return { errors: {}, message: CHANGED_NOT_LOGGED_IN };
  }
  await setDeviceCookie(result.device, now).catch((error: unknown) => {
    console.error(`password change: couldn't set the device cookie: ${errorSummary(error)}`);
  });
  return { errors: {}, done: true };
}

export async function deleteAccountAction(_prev: DeleteFormState, formData: FormData): Promise<DeleteFormState> {
  const userId = await accountUserId("account delete");
  if (!userId) return { errors: {}, message: UNAVAILABLE };
  let result: DeleteAccountResult;
  try {
    result = await deleteAccount(getDb, userId, { current: formData.get("current"), confirm: formData.get("confirm") }, { ip: await requestIp(), now: new Date() });
  } catch (error) {
    console.error(`account delete failed: ${errorSummary(error)}`);
    return { errors: {}, message: UNAVAILABLE };
  }
  if (!result.ok) return result.reason === "invalid" ? { errors: result.errors } : { errors: {}, message: result.message };
  // The account is gone either way; a cookie left behind matches nothing.
  await clearAccountCookies().catch((error: unknown) => {
    console.error(`account delete: couldn't clear the cookies: ${errorSummary(error)}`);
  });
  redirect("/");
}
