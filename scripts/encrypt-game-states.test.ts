// The backfill for game states stored before #84, on PGlite with the real migrations.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Vault } from "../src/crypto/vault";
import type { AnyDb } from "../src/db/content";
import { STATE_FIELD, stateKeyId } from "../src/db/game-state-key";
import * as schema from "../src/db/schema";
import { newUserRow } from "../src/auth/user-row";
import { encryptGameStates, keySourceProblem, KeyMismatchError } from "./encrypt-game-states";

const vault = new Vault(Buffer.alloc(32, 3));
const anonId = createHash("sha256").update("cookie").digest("hex");
const STATE = { packId: "pk_t", events: [{ type: "wrongGuess", puzzleId: "p1" }], finished: true };

let pg: PGlite;
let db: AnyDb;

beforeAll(async () => {
  pg = new PGlite();
  const client = drizzle({ client: pg, schema });
  await migrate(client, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  db = client as unknown as AnyDb;
  await pg.query("INSERT INTO packs (id, kind, title, theme) VALUES ('pk_t', 'practice', 'T', 'T')");
}, 60_000);

afterAll(async () => {
  await pg.close();
});

async function insertPlain(): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    "INSERT INTO games (pack_id, anon_owner_hash, state) VALUES ('pk_t', $1, $2::jsonb) RETURNING id",
    [anonId, JSON.stringify(STATE)],
  );
  return rows[0]!.id;
}

describe("encryptGameStates", () => {
  it("encrypts every plain state with its game's key, leaving no plain copy", async () => {
    const ids = [await insertPlain(), await insertPlain(), await insertPlain()];
    expect(await encryptGameStates(db, vault, 2)).toEqual({ encrypted: 3, skipped: 0, left: 0 });
    for (const id of ids) {
      const { rows } = await pg.query<{ state: unknown; state_encrypted: string }>(
        "SELECT state, state_encrypted FROM games WHERE id = $1",
        [id],
      );
      expect(rows[0]!.state).toBeNull();
      expect(vault.decryptJson(stateKeyId(id), STATE_FIELD, rows[0]!.state_encrypted)).toEqual(STATE);
    }
  });

  it("does nothing the second time", async () => {
    await insertPlain();
    await encryptGameStates(db, vault);
    expect(await encryptGameStates(db, vault)).toEqual({ encrypted: 0, skipped: 0, left: 0 });
  });

  it("reads one batch at a time, paging by id, and stops", async () => {
    const ids = [];
    for (let i = 0; i < 10; i++) ids.push(await insertPlain());
    // Rows each batch SELECT returned (the UPDATEs return only an id). Empty
    // results count only after the first batch, so the key check's lookups don't.
    const batches: number[] = [];
    const counting = {
      execute: async (query: Parameters<AnyDb["execute"]>[0]) => {
        const result = await db.execute(query);
        const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
        if (rows.length === 0 ? batches.length > 0 : "revision" in rows[0]!) batches.push(rows.length);
        return result;
      },
    } as unknown as AnyDb;
    expect(await encryptGameStates(counting, vault, 2)).toEqual({ encrypted: 10, skipped: 0, left: 0 });
    expect(batches).toEqual([2, 2, 2, 2, 2, 0]);
    const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM games WHERE state_encrypted IS NULL");
    expect(rows[0]!.n).toBe(0);
    for (const id of ids) expect((await pg.query("SELECT 1 FROM games WHERE id = $1 AND state IS NULL", [id])).rows).toHaveLength(1);
  });

  /** A db that saves game `id` (bumps its revision) right after the backfill reads it, the first `times` reads. */
  function racing(id: string, times: number): AnyDb {
    let left = times;
    return {
      execute: async (query: Parameters<AnyDb["execute"]>[0]) => {
        const result = await db.execute(query);
        const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
        if (left > 0 && rows.length > 0 && "revision" in rows[0]!) {
          left--;
          await pg.query("UPDATE games SET revision = revision + 1 WHERE id = $1", [id]);
        }
        return result;
      },
    } as unknown as AnyDb;
  }

  it("retries a game that changed meanwhile once, at the end, so a finished game doesn't stay plain", async () => {
    const id = await insertPlain();
    expect(await encryptGameStates(racing(id, 1), vault)).toEqual({ encrypted: 1, skipped: 1, left: 0 });
    const { rows } = await pg.query<{ state: unknown }>("SELECT state FROM games WHERE id = $1", [id]);
    expect(rows[0]!.state).toBeNull();
    await pg.query("DELETE FROM games WHERE id = $1", [id]);
  });

  it("reports a game that keeps changing as still plain, so the run can be repeated", async () => {
    const id = await insertPlain();
    expect(await encryptGameStates(racing(id, 2), vault)).toEqual({ encrypted: 0, skipped: 1, left: 1 });
    expect(await encryptGameStates(db, vault)).toEqual({ encrypted: 1, skipped: 0, left: 0 });
    await pg.query("DELETE FROM games WHERE id = $1", [id]);
  });

  it("bumps the revision, so a save racing the backfill gets a conflict instead of a constraint error", async () => {
    const id = await insertPlain();
    const before = (await pg.query<{ revision: number }>("SELECT revision FROM games WHERE id = $1", [id])).rows[0]!.revision;
    await encryptGameStates(db, vault);
    const after = (await pg.query<{ revision: number }>("SELECT revision FROM games WHERE id = $1", [id])).rows[0]!.revision;
    expect(after).toBe(before + 1);
    await pg.query("DELETE FROM games WHERE id = $1", [id]);
  });
});

describe("refusing the wrong key", () => {
  const otherVault = new Vault(Buffer.alloc(32, 9));

  async function plainCount(): Promise<number> {
    return (await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM games WHERE state_encrypted IS NULL")).rows[0]!.n;
  }

  it("changes nothing when the key doesn't decrypt a game state already encrypted", async () => {
    await insertPlain();
    await encryptGameStates(db, vault); // leaves encrypted games behind
    const id = await insertPlain();
    await expect(encryptGameStates(db, otherVault)).rejects.toBeInstanceOf(KeyMismatchError);
    expect(await plainCount()).toBe(1);
    const { rows } = await pg.query<{ state: unknown }>("SELECT state FROM games WHERE id = $1", [id]);
    expect(rows[0]!.state).toEqual(STATE);
    await pg.query("DELETE FROM games WHERE id = $1", [id]);
  });

  it("changes nothing when the key doesn't decrypt a username, even before any game is encrypted", async () => {
    const fresh = new PGlite();
    const client = drizzle({ client: fresh, schema });
    await migrate(client, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    const freshDb = client as unknown as AnyDb;
    await client.insert(schema.users).values(newUserRow(vault, "alice", "x"));
    await fresh.query("INSERT INTO packs (id, kind, title, theme) VALUES ('pk_t', 'practice', 'T', 'T')");
    await fresh.query("INSERT INTO games (pack_id, anon_owner_hash, state) VALUES ('pk_t', $1, $2::jsonb)", [
      anonId,
      JSON.stringify(STATE),
    ]);
    await expect(encryptGameStates(freshDb, otherVault)).rejects.toBeInstanceOf(KeyMismatchError);
    expect((await fresh.query("SELECT 1 FROM games WHERE state_encrypted IS NULL")).rows).toHaveLength(1);
    expect(await encryptGameStates(freshDb, vault)).toEqual({ encrypted: 1, skipped: 0, left: 0 });
    await fresh.close();
  }, 60_000);
});

describe("keySourceProblem", () => {
  const URL = "a-database-url"; // only whether it is set matters
  const KEY = Buffer.alloc(32, 1).toString("base64");
  const both = { DATABASE_URL_UNPOOLED: URL, DATA_ENCRYPTION_KEY: KEY };

  it("refuses a URL from the environment with the key from .env.local", () => {
    expect(keySourceProblem({ DATABASE_URL_UNPOOLED: URL }, both)).toMatch(/DATABASE_URL_UNPOOLED came from the environment/);
  });

  it("refuses a key from the environment with the URL from .env.local", () => {
    expect(keySourceProblem({ DATA_ENCRYPTION_KEY: KEY }, both)).toMatch(/DATA_ENCRYPTION_KEY came from the environment/);
  });

  it("allows both from the environment, or both from .env.local", () => {
    expect(keySourceProblem(both, both)).toBeUndefined();
    expect(keySourceProblem({}, both)).toBeUndefined();
  });
});
