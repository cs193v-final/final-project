// The scheduled sweep (#154) on a real database (PGlite, real migrations):
// it deletes only expired sessions and rate-limit rows whose window has ended
// for every limit, and leaves everything else.
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { PgDb } from "@/db/accounts";
import * as schema from "@/db/schema";

import { RATE_LIMIT_MAX_AGE_MS, sweepExpired } from "./sweep";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let pg: PGlite;
let db: PgDb;

beforeAll(async () => {
  pg = new PGlite();
  const client = drizzle({ client: pg, schema });
  await migrate(client, { migrationsFolder });
  db = client as unknown as PgDb;
}, 60_000);

afterAll(async () => {
  await pg.close();
});

const NOW = new Date("2026-11-17T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

it("deletes only expired sessions and rate-limit rows past the longest window", async () => {
  const [user] = await db
    .insert(schema.users)
    .values({ usernameEncrypted: "enc", usernameIndex: "idx", passwordHash: "hash" })
    .returning({ id: schema.users.id });
  if (!user) throw new Error("no user");
  await db.insert(schema.sessions).values([
    { tokenHash: "expired", userId: user.id, expiresAt: ago(1) },
    { tokenHash: "live", userId: user.id, expiresAt: new Date(NOW.getTime() + 1) },
  ]);
  await db.insert(schema.rateLimits).values([
    { key: "old", windowStart: ago(RATE_LIMIT_MAX_AGE_MS + 1), count: 3 },
    { key: "just-in-window", windowStart: ago(RATE_LIMIT_MAX_AGE_MS - 1), count: 1 },
    { key: "fresh", windowStart: NOW, count: 1 },
  ]);

  expect(await sweepExpired(db, NOW)).toEqual({ sessions: 1, rateLimits: 1 });

  const sessions = await db.select({ t: schema.sessions.tokenHash }).from(schema.sessions);
  expect(sessions.map((s) => s.t)).toEqual(["live"]);
  const limits = await db.select({ k: schema.rateLimits.key }).from(schema.rateLimits);
  expect(limits.map((r) => r.k).sort()).toEqual(["fresh", "just-in-window"]);
  expect(await sweepExpired(db, NOW)).toEqual({ sessions: 0, rateLimits: 0 });
});
