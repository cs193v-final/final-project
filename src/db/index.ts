// The database client (#47). Server-only: importing this from a Client
// Component fails the build, and `src/db/boundary.test.ts` checks that no
// component or "use client" file imports it.
import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";
import { assertDatabaseUrlRequiresTls } from "./tls";

export { schema };

export type Db = NeonHttpDatabase<typeof schema>;

let db: Db | undefined;

/**
 * The shared Drizzle client, created on first use. Nothing connects at import
 * time, so `next build` works without `DATABASE_URL`.
 *
 * Refuses a connection string that doesn't require TLS (`sslmode=require`,
 * `verify-ca` or `verify-full`; see ./tls.ts), except for a database on
 * localhost. The error never contains the connection string.
 *
 * Uses Neon's HTTP driver with the pooled `DATABASE_URL`: one HTTP request per
 * query, no connection to keep open between serverless invocations. It has no
 * interactive transactions; use `db.batch([...])` for several statements that
 * must succeed or fail together.
 */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Locally, copy .env.example to .env.local (see README.md → Database).",
      );
    }
    assertDatabaseUrlRequiresTls(url, "DATABASE_URL");
    db = drizzle({ client: neon(url), schema });
  }
  return db;
}
