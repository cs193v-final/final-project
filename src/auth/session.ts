// The current user, from the session cookie (#53). Server-only: Server
// Components, Server Actions and Route Handlers call these; the browser only
// ever sees a `PublicUser`.
//
// The cookie holds a random token; the database holds its SHA-256 (see
// ./crypto.ts). The cookie is HttpOnly (no JavaScript can read it), Secure
// (HTTPS only; browsers also allow it on http://localhost for dev), and
// SameSite=Lax (not sent on cross-site form posts, so another site can't log
// someone in or out).
import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getDb } from "@/db";
import { deleteSession, findSessionUser } from "@/db/accounts";
import type { PublicUser } from "@/game/types";

import { sha256Hex } from "./crypto";

export const SESSION_COOKIE = "zo_session";

/** The logged-in user, or `null`. Checks the session in the database on every call, so logout and expiry apply at once. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = await requestSessionToken();
  if (!token) return null;
  return findSessionUser(getDb(), sha256Hex(token), new Date());
}

/**
 * Like `getCurrentUser`, but a database error counts as logged out (and is
 * logged). For the header, which is on every page, including ones that don't
 * need the database. Only the database lookup is caught: Next's own
 * request-time signals from `cookies()` and `connection()` must reach Next.
 */
export async function getCurrentUserOrLoggedOut(): Promise<PublicUser | null> {
  const token = await requestSessionToken();
  if (!token) return null;
  try {
    return await findSessionUser(getDb(), sha256Hex(token), new Date());
  } catch (error) {
    console.error("Couldn't check the session; showing the user as logged out", error);
    return null;
  }
}

/** The session cookie's token, if any. After this, it's request time. */
async function requestSessionToken(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // Cache Components: reading the clock needs an explicit "this is request
  // time" first, or Next reports `new Date()` as a prerender error.
  await connection();
  return token;
}

/** The logged-in user; otherwise redirects to the login page. */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Sets the session cookie. Only from a Server Action or Route Handler. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Ends the session on the server and removes the cookie. Only from a Server Action or Route Handler. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), sha256Hex(token));
  jar.delete(SESSION_COOKIE);
}

/**
 * The client's IP address, for rate limiting only (stored hashed). On Vercel,
 * `x-forwarded-for` is set by Vercel's edge and its first entry is the client.
 */
export async function requestIp(): Promise<string | null> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || h.get("x-real-ip") || null;
}
