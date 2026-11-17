// Who owns a game: the logged-in user, or an anonymous owner cookie (#54).
// Server-only.
//
// The anonymous cookie holds a random 32-byte token (base64url). The server
// only ever uses its SHA-256 hex digest as the owner id (`{ anonId }`), and
// that digest is what `games.anon_owner_hash` stores, so a database leak
// doesn't let anyone act on someone else's games.
//
// Anonymous players may play the daily too (settled in #58 with Jacky and
// Ethan): only games started while logged in count for leaderboards and
// streaks (#62, #63 filter on user_id IS NOT NULL).
import "server-only";

import { cookies, headers } from "next/headers";

import { isToken, newToken, sha256Hex } from "@/auth/crypto";
import type { GameOwner } from "@/game/server-game";

import { getCurrentUser } from "./current-user";
import { isHttpsRequest } from "./https";

export { isHttpsRequest };

export const OWNER_COOKIE = "zo_owner";

/** About a year; browsers cap cookie lifetimes at 400 days anyway. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** A new owner token: 32 random bytes as base64url, the same format as session tokens. */
export const newOwnerToken = newToken;

/** The owner id for a cookie token: its SHA-256 as lowercase hex. */
export const hashOwnerToken = sha256Hex;

/** A cookie value we issued, rather than garbage or a tampered value. */
export const isOwnerToken = isToken;

/**
 * Cookie options for the owner cookie. `Secure` whenever the request came in
 * over https; on plain http (local dev, e2e, testing from a phone on the LAN)
 * a Secure cookie would be dropped by the browser, so it's left off there.
 */
export function ownerCookieOptions(forwardedProto: string | null) {
  return {
    httpOnly: true,
    secure: isHttpsRequest(forwardedProto),
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/** This request's owner, or null if there is none yet. Works anywhere on the server (reads only). */
export async function currentOwner(): Promise<GameOwner | null> {
  const user = await getCurrentUser();
  if (user) return { userId: user.id };
  const token = (await cookies()).get(OWNER_COOKIE)?.value;
  return isOwnerToken(token) ? { anonId: hashOwnerToken(token) } : null;
}

/**
 * This request's owner, creating the anonymous owner cookie if there is none.
 * Sets a cookie, so call it only from a Server Action or Route Handler.
 */
export async function currentOrNewOwner(): Promise<GameOwner> {
  const owner = await currentOwner();
  if (owner) return owner;
  const token = newOwnerToken();
  const proto = (await headers()).get("x-forwarded-proto");
  (await cookies()).set(OWNER_COOKIE, token, ownerCookieOptions(proto));
  return { anonId: hashOwnerToken(token) };
}
