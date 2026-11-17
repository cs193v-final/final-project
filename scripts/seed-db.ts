// The seed script's database connection (#52). The driver depends on the host,
// the same rule as #54's `src/db/index.ts` (which is server-only, so the seed
// script can't import it):
// - Neon (dev, preview, production): Neon's HTTP driver.
// - A Postgres on this machine (localhost, 127.x, ::1: CI's e2e service
//   container or a laptop): node-postgres (`pg`), since Neon's HTTP driver only
//   talks to Neon.

import type { AnyDb } from "../src/db/content.ts";

/** `localhost`, `127.0.0.0/8` or `::1` (with or without brackets). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/u.test(host);
}

export function driverFor(url: string): "pg" | "neon" {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL_UNPOOLED is not a valid connection URL.");
  }
  return isLoopbackHost(host) ? "pg" : "neon";
}

/** Connects with the right driver. Call `close()` when done. */
export async function connect(url: string): Promise<{ db: AnyDb; close: () => Promise<void> }> {
  if (driverFor(url) === "neon") {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    return { db: drizzle({ client: neon(url) }), close: async () => {} };
  }
  // `pg` arrives with #54 (#77). Until then it may not be installed, so load it
  // only here, by a name TypeScript doesn't resolve.
  const pgName = "pg";
  const driverName = "drizzle-orm/node-postgres";
  let pg: { default: { Pool: new (config: { connectionString: string }) => { end(): Promise<void> } } };
  try {
    pg = await import(pgName);
  } catch {
    throw new Error("Seeding a local Postgres needs the `pg` driver. Run `npm ci` after #77 is on main.");
  }
  const { drizzle } = (await import(driverName)) as { drizzle: (config: { client: unknown }) => AnyDb };
  const pool = new pg.default.Pool({ connectionString: url });
  return { db: drizzle({ client: pool }), close: () => pool.end() };
}
