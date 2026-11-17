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
import { encryptGameStates } from "./encrypt-game-states";

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
    expect(await encryptGameStates(db, vault, 2)).toEqual({ encrypted: 3, skipped: 0 });
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
    expect(await encryptGameStates(db, vault)).toEqual({ encrypted: 0, skipped: 0 });
  });

  it("reads one batch at a time, paging by id, and stops", async () => {
    const ids = [];
    for (let i = 0; i < 10; i++) ids.push(await insertPlain());
    // Rows each SELECT returned (the UPDATEs return only an id).
    const batches: number[] = [];
    const counting = {
      execute: async (query: Parameters<AnyDb["execute"]>[0]) => {
        const result = await db.execute(query);
        const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
        if (rows.length === 0 || "revision" in rows[0]!) batches.push(rows.length);
        return result;
      },
    } as unknown as AnyDb;
    expect(await encryptGameStates(counting, vault, 2)).toEqual({ encrypted: 10, skipped: 0 });
    expect(batches).toEqual([2, 2, 2, 2, 2, 0]);
    const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM games WHERE state_encrypted IS NULL");
    expect(rows[0]!.n).toBe(0);
    for (const id of ids) expect((await pg.query("SELECT 1 FROM games WHERE id = $1 AND state IS NULL", [id])).rows).toHaveLength(1);
  });

  it("skips a game that changed meanwhile, without stopping", async () => {
    const id = await insertPlain();
    const racing = {
      execute: async (query: Parameters<AnyDb["execute"]>[0]) => {
        const result = await db.execute(query);
        const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
        // Another request saves the game right after the backfill read it.
        if (rows.length > 0 && "revision" in rows[0]!) await pg.query("UPDATE games SET revision = revision + 1 WHERE id = $1", [id]);
        return result;
      },
    } as unknown as AnyDb;
    expect(await encryptGameStates(racing, vault)).toEqual({ encrypted: 0, skipped: 1 });
    await pg.query("DELETE FROM games WHERE id = $1", [id]);
  });
});
