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

/**
 * Whether the request reached us over https, from `X-Forwarded-Proto`. Next
 * sets that header from the connection when a proxy (e.g. Vercel) hasn't, so
 * plain `next dev` / `next start` report "http". With a proxy chain the
 * first value is the client's. Unknown means https, the safe default.
 */
export function isHttpsRequest(forwardedProto: string | null): boolean {
  const first = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  return first === undefined || first === "" ? true : first === "https";
}

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
