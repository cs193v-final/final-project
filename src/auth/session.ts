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
import { cache } from "react";

import { getDb } from "@/db";
import { deleteSession } from "@/db/accounts";
import { getVault } from "@/crypto/vault";
import type { PublicUser } from "@/game/types";
import { isHttpsRequest } from "@/server/https";

import { sessionUser } from "./accounts";
import { isToken, sha256Hex } from "./crypto";
import { loginPath } from "./next-path";

export const SESSION_COOKIE = "zo_session";

/**
 * A failed session lookup. Its message is only the error's type and code: the
 * query error itself carries the SQL and the token hash, and callers such as
 * `runGameCall` and Next log whatever they're given.
 */
export class SessionLookupError extends Error {
  constructor(cause: unknown) {
    super(`Couldn't check the session: ${describeError(cause)}`);
    this.name = "SessionLookupError";
  }
}

/**
 * One database lookup per token per request. The header and the page (e.g.
 * `requireUser`, or `currentOwner` inside a game call) both ask who's logged
 * in, and with Neon HTTP each query is a network round trip.
 */
const lookupSession = cache(async (token: string): Promise<PublicUser | null> => {
  try {
    return await sessionUser(getDb(), getVault(), sha256Hex(token), new Date());
  } catch (error) {
    throw new SessionLookupError(error);
  }
});

/** The logged-in user, or `null`. Checks the session in the database on every request, so logout and expiry apply at once. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const token = await requestSessionToken();
  return token ? lookupSession(token) : null;
}

/**
 * Like `getCurrentUser`, but a database or decryption error counts as logged out (and is
 * logged). For the header, which is on every page, including ones that don't
 * need the database. Only the database lookup is caught: Next's own
 * request-time signals from `cookies()` and `connection()` must reach Next.
 */
export async function getCurrentUserOrLoggedOut(): Promise<PublicUser | null> {
  const token = await requestSessionToken();
  if (!token) return null;
  try {
    return await lookupSession(token);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : describeError(error)}; showing the user as logged out`);
    return null;
  }
}

/**
 * The session cookie's token, if it's shaped like one we issue. Anything else
 * (garbage, a tampered value) is logged out without a query. After this, it's
 * request time.
 */
async function requestSessionToken(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isToken(token)) return null;
  // Cache Components: reading the clock needs an explicit "this is request
  // time" first, or Next reports `new Date()` as a prerender error.
  await connection();
  return token;
}

/**
 * The logged-in user; otherwise redirects to the login page, which comes back
 * to `next` (the page asking, e.g. "/account") after logging in (#134).
 */
export async function requireUser(next?: string): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginPath(next));
  return user;
}

/**
 * The session cookie's options. `Secure` whenever the request came in over
 * https (always on Vercel). On plain http, e.g. testing from a phone on the
 * LAN, a browser drops a Secure cookie, so it's left off there, the same rule
 * as #77's owner cookie (`isHttpsRequest`).
 */
export function sessionCookieOptions(expiresAt: Date, forwardedProto: string | null) {
  return {
    httpOnly: true,
    secure: isHttpsRequest(forwardedProto),
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/**
 * Starts a session in the browser: ends the one this browser already had (if
 * any), so logging in again doesn't leave an old session valid for 30 days,
 * then sets the new cookie. Only from a Server Action or Route Handler.
 */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  const previous = jar.get(SESSION_COOKIE)?.value;
  if (isToken(previous) && previous !== token) {
    // Best effort: if this fails the login still goes ahead, and the old
    // session simply expires. Never log the query error itself.
    await deleteSession(getDb(), sha256Hex(previous)).catch((error: unknown) => {
      console.error(`Couldn't end the previous session: ${describeError(error)}`);
    });
  }
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt, (await headers()).get("x-forwarded-proto")));
}

/** Ends the session on the server and removes the cookie. Only from a Server Action or Route Handler. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(getDb(), sha256Hex(token));
  jar.delete(SESSION_COOKIE);
}

/**
 * The client's IP address, for rate limiting only (stored hashed).
 *
 * Assumes Vercel: its edge sets `x-vercel-forwarded-for` and overwrites
 * `x-forwarded-for`, so a client can't choose its own address. On any other
 * host these headers come from the client and can be spoofed, which would let
 * someone dodge the per-address limits (the per-username limit still holds).
 * With no header at all (local dev, CI) every request shares one "unknown"
 * address.
 */
export async function requestIp(): Promise<string | null> {
  const h = await headers();
  const first = (name: string) => h.get(name)?.split(",")[0]?.trim() || null;
  return first("x-vercel-forwarded-for") ?? first("x-forwarded-for") ?? first("x-real-ip");
}

/**
 * A short description of an error for the server log. Never the error itself:
 * a failed query's message includes its parameters (a username, a password
 * hash).
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error.cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown }).code;
  return typeof code === "string" ? `${error.name} (${code})` : error.name;
}
