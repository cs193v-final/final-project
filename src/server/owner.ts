// Who owns a game: the logged-in user, or an anonymous owner cookie (#54).
// Server-only.
//
// The anonymous cookie holds a random 32-byte token (base64url). The server
// only ever uses its SHA-256 hex digest as the owner id (`{ anonId }`), and
// that digest is what `games.anon_owner_hash` stores, so a database leak
// doesn't let anyone act on someone else's games.
//
// Whether anonymous players may start *daily* games is an open decision
// (#54/#62); today only the practice pack can be started (src/server/games.ts).
import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";

import { isLoopbackHost } from "@/db";
import type { GameOwner } from "@/game/server-game";

import { getCurrentUser } from "./current-user";

export const OWNER_COOKIE = "zo_owner";

/** 32 random bytes as base64url: 43 characters, no padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** About a year; browsers cap cookie lifetimes at 400 days anyway. */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function newOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The owner id for a cookie token: its SHA-256 as lowercase hex. */
export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A cookie value we issued, rather than garbage or a tampered value. */
export function isOwnerToken(value: string | undefined): value is string {
  return value !== undefined && TOKEN.test(value);
}

/** The hostname from a `Host` header ("127.0.0.1:3100", "[::1]:3000", "example.com"). */
export function hostnameOf(hostHeader: string | null): string {
  if (!hostHeader) return "";
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0] ?? "";
}

/**
 * Cookie options for the owner cookie. `Secure` everywhere except when the
 * site is served from this machine (localhost / 127.0.0.1 / ::1), which is
 * plain http in `npm run dev` and in the e2e tests' `next start`. A deployed
 * site is never reached through a loopback host.
 */
export function ownerCookieOptions(hostHeader: string | null) {
  return {
    httpOnly: true,
    secure: !isLoopbackHost(hostnameOf(hostHeader)),
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
  const host = (await headers()).get("host");
  (await cookies()).set(OWNER_COOKIE, token, ownerCookieOptions(host));
  return { anonId: hashOwnerToken(token) };
}
