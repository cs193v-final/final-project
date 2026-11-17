// The seed script's database connection (#52). The driver depends on the host,
// by the same loopback rule as `src/db/index.ts` and the TLS exemption
// (`isLoopbackDatabaseUrl` in src/db/tls.ts, which has no imports, so Node
// can run it here; src/db/index.ts itself is server-only):
// - Neon (dev, preview, production): Neon's HTTP driver.
// - A Postgres on this machine (localhost, 127.x, ::1: CI's e2e service
//   container or a laptop): node-postgres (`pg`), since Neon's HTTP driver only
//   talks to Neon.

import type { AnyDb } from "../src/db/content.ts";
import { assertDatabaseUrlRequiresTls, isLoopbackDatabaseUrl } from "../src/db/tls.ts";

export function driverFor(url: string, variable = "DATABASE_URL_UNPOOLED"): "pg" | "neon" {
  try {
    new URL(url);
  } catch {
    throw new Error(`${variable} is not a valid connection URL.`);
  }
  return isLoopbackDatabaseUrl(url) ? "pg" : "neon";
}

/**
 * Connects with the right driver. Call `close()` when done. `variable` names
 * where `url` came from, for error messages.
 *
 * Checks TLS first, before loading any driver, so no caller can connect
 * without it (#60).
 */
export async function connect(
  url: string,
  variable = "DATABASE_URL_UNPOOLED",
): Promise<{ db: AnyDb; close: () => Promise<void> }> {
  assertDatabaseUrlRequiresTls(url, variable);
  if (driverFor(url, variable) === "neon") {
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
