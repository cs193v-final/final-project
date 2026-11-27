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
import { assertDatabaseUrlRequiresTls, isLoopbackDatabaseUrl } from "./tls";

export { schema };

/**
 * The Drizzle client, whichever driver is behind it. Only the query builder and
 * `db.execute` are common to both drivers: `db.batch` is Neon HTTP only and
 * interactive transactions are node-postgres (and PGlite) only. Make writes
 * that must happen together a single SQL statement (a CTE), or group them with
 * `inOneTransaction` in `src/db/games.ts` (`batch` on Neon HTTP, a transaction
 * elsewhere), as its capped `create` does (#225).
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type Cached = { url: string; db: Db };

/**
 * Where the client is kept. In production, this module. In development (and
 * tests) on `globalThis`: hot reload re-runs this module, and a module-level
 * node-postgres Pool would leak its connections on every edit. Keyed by URL so
 * a changed `DATABASE_URL` gets a new client.
 */
const devCache = globalThis as typeof globalThis & { __zoomOutDb?: Cached };
let prodCache: Cached | undefined;

/**
 * The shared Drizzle client, created on first use. Nothing connects at import
 * time, so `next build` works without `DATABASE_URL`.
 *
 * Refuses a connection string that doesn't require TLS (`sslmode=require`,
 * `verify-ca` or `verify-full`; see ./tls.ts), except for a database on this
 * machine. The error never contains the connection string.
 *
 * The driver depends on where the database is, by the same loopback rule as
 * the TLS exemption (`isLoopbackDatabaseUrl` in ./tls.ts):
 * - **Neon** (any non-loopback host: dev, preview, production): Neon's HTTP
 *   driver with the pooled `DATABASE_URL`. One HTTP request per query, no
 *   connection to keep open between serverless invocations.
 * - **A Postgres on this machine** (localhost / 127.0.0.0/8 / ::1: the CI e2e
 *   job's service container, or a local Postgres for e2e runs): node-postgres
 *   (`pg`) over TCP. The Neon HTTP driver only talks to Neon's HTTP endpoint,
 *   not to a plain Postgres. See TECHNICAL.md → Database.
 */
export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Locally, copy .env.example to .env.local (see README.md → Database).",
    );
  }
  assertDatabaseUrlRequiresTls(url, "DATABASE_URL");
  const production = process.env.NODE_ENV === "production";
  const cached = production ? prodCache : devCache.__zoomOutDb;
  if (cached?.url === url) return cached.db;

  const db: Db = isLoopbackDatabaseUrl(url)
    ? drizzleNodePg({ client: new Pool({ connectionString: url, max: 5 }), schema })
    : drizzleNeonHttp({ client: neon(url), schema });
  if (production) prodCache = { url, db };
  else devCache.__zoomOutDb = { url, db };
  return db;
}
