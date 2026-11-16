// The database client (#47). Server-only: importing this from a Client
// Component fails the build, and `src/db/boundary.test.ts` checks that no
// component or "use client" file imports it.
import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import * as schema from "./schema";

export { schema };

/**
 * The Drizzle client, whichever driver is behind it. Only the query builder and
 * `db.execute` are common to both drivers: no `db.batch` (Neon HTTP only) and
 * no interactive transactions (node-postgres only). Make writes that must
 * happen together a single SQL statement (a CTE), as `src/db/games.ts` does.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let db: Db | undefined;

/**
 * True when a connection string points at this machine (localhost, 127.x.x.x
 * or ::1). Throws on a string that isn't a URL, without echoing it (it may
 * hold a password).
 */
export function isLoopbackDatabaseUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL.");
  }
  return isLoopbackHost(host);
}

/** `localhost`, `127.0.0.0/8` or `::1` (with or without brackets). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * The shared Drizzle client, created on first use. Nothing connects at import
 * time, so `next build` works without `DATABASE_URL`.
 *
 * The driver depends on where the database is:
 * - **Neon** (any non-loopback host: dev, preview, production): Neon's HTTP
 *   driver with the pooled `DATABASE_URL`. One HTTP request per query, no
 *   connection to keep open between serverless invocations.
 * - **A Postgres on this machine** (localhost / 127.0.0.1 / ::1: the CI e2e
 *   job's service container, or a local Postgres for e2e runs): node-postgres
 *   (`pg`) over TCP. The Neon HTTP driver only talks to Neon's HTTP endpoint,
 *   not to a plain Postgres. See TECHNICAL.md → Database.
 */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Locally, copy .env.example to .env.local (see README.md → Database).",
      );
    }
    db = isLoopbackDatabaseUrl(url)
      ? drizzleNodePg({ client: new Pool({ connectionString: url, max: 5 }), schema })
      : drizzleNeonHttp({ client: neon(url), schema });
  }
  return db;
}
