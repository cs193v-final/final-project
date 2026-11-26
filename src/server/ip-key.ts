// Keyed hashes of client IP addresses, for rate limiting only (#85). Server-only.
//
// Plain SHA-256 of an IPv4 address can be reversed by hashing all 2^32
// addresses (#84), so `rate_limits` keys use HMAC-SHA-256 with a secret key
// instead. Without the key, a leaked `rate_limits` table says nothing about
// who visited. The address itself is never stored or logged.
//
// The key is `RATE_LIMIT_HMAC_KEY` (at least 32 characters, e.g.
// `openssl rand -base64 32`), a separate value per tier like the database
// URLs. On Vercel preview and production it's required: without it, starting
// and playing games fails with `unavailable` rather than silently limiting
// per server instance. Locally (dev, e2e, CI) a random key is made per process,
// so the limits still work, and restarting the server starts them over.
import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { rateLimitAddress } from "@/auth/rate-limit-address";

export const IP_KEY_ENV = "RATE_LIMIT_HMAC_KEY";
export const MIN_KEY_LENGTH = 32;

let processKey: Buffer | undefined;

/** The HMAC key for IP addresses, from `RATE_LIMIT_HMAC_KEY`. See the top of this file. */
export function ipHmacKey(env: Readonly<Record<string, string | undefined>> = process.env): Buffer {
  const value = env[IP_KEY_ENV];
  if (value) {
    // Never include the value in the message.
    if (value.length < MIN_KEY_LENGTH) throw new Error(`${IP_KEY_ENV} must be at least ${MIN_KEY_LENGTH} characters`);
    return Buffer.from(value, "utf8");
  }
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    throw new Error(`${IP_KEY_ENV} is not set. Add it in Vercel for this environment (see TECHNICAL.md, Rate limits).`);
  }
  if (processKey === undefined) {
    processKey = randomBytes(32);
    console.warn(`${IP_KEY_ENV} is not set; using a random key until this server restarts (fine for dev and tests).`);
  }
  return processKey;
}

/**
 * HMAC-SHA-256 of the address a client IP counts as, as hex, or `"unknown"`
 * when the request had none (every such request then shares one bucket).
 * The address goes through `rateLimitAddress` first (#167), so an IPv6 address
 * counts by its /64 however it was written (`2001:DB8::1` and `2001:db8::abcd`
 * together), and `::ffff:203.0.113.7` counts with `203.0.113.7`. IPv4 and
 * `::ffff:` addresses hash exactly as they did before #167. Anything that isn't
 * an IP address is still trimmed, lowercased and stripped of `::ffff:`.
 */
export function hashIp(ip: string | null, key: Buffer): string {
  const trimmed = ip?.trim().toLowerCase();
  if (!trimmed) return "unknown";
  const address = rateLimitAddress(trimmed).replace(/^::ffff:/, "");
  return createHmac("sha256", key).update(address, "utf8").digest("hex");
}
