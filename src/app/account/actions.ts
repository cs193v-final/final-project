"use server";
// Register, log in and log out (#53). Server Actions are reachable by direct
// POST, so each one validates its own input; Next.js also checks the Origin
// header, which blocks cross-site posts.
import { redirect } from "next/navigation";

import { login, register, type AuthResult, type FieldErrors } from "@/auth/accounts";
import { endSession, requestIp, setSessionCookie } from "@/auth/session";
import { getDb } from "@/db";

/** What the forms show after a failed submit. Never echoes the password. */
export type AccountFormState = { username: string; errors: FieldErrors; message?: string } | undefined;

async function finish(result: AuthResult, formData: FormData): Promise<AccountFormState> {
  if (result.ok) {
    await setSessionCookie(result.session.token, result.session.expiresAt);
    redirect("/account");
  }
  const username = typeof formData.get("username") === "string" ? String(formData.get("username")) : "";
  if (result.reason === "invalid" || result.reason === "taken") return { username, errors: result.errors };
  return { username, errors: {}, message: result.message };
}

export async function registerAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const input = { username: formData.get("username"), password: formData.get("password") };
  const result = await register(getDb, input, { ip: await requestIp(), now: new Date() });
  return finish(result, formData);
}

export async function loginAction(_prev: AccountFormState, formData: FormData): Promise<AccountFormState> {
  const input = { username: formData.get("username"), password: formData.get("password") };
  const result = await login(getDb, input, { ip: await requestIp(), now: new Date() });
  return finish(result, formData);
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/");
}
