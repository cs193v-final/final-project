import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyPassword } from "../src/auth/crypto";
import type { PgDb } from "../src/db/accounts";
import * as schema from "../src/db/schema";
import { createTestUser, parseInput, UsageError } from "./create-test-user";

describe("parseInput", () => {
  it("takes one username and the password from the environment", () => {
    expect(parseInput(["ethan"], "test password")).toEqual({ username: "ethan", password: "test password" });
  });

  it.each([
    [[], "test password"],
    [["a", "b"], "test password"],
    [["ethan@stanford.edu"], "test password"],
    [["ethan"], undefined],
    [["ethan"], "short"],
  ])("rejects %j with password %j", (args, password) => {
    expect(() => parseInput(args, password)).toThrow(UsageError);
  });

  it("never puts the password in an error message", () => {
    expect(() => parseInput(["a"], "secret-pass-123")).toThrow(expect.objectContaining({ message: expect.not.stringContaining("secret-pass-123") }));
  });
});

describe("createTestUser", () => {
  let pg: PGlite;
  let db: PgDb;

  beforeAll(async () => {
    pg = new PGlite();
    const client = drizzle({ client: pg, schema });
    await migrate(client, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    db = client as unknown as PgDb;
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it("creates the user with a hashed password, and leaves an existing one alone", async () => {
    expect(await createTestUser(db, { username: "ethan", password: "first password" })).toMatch(/Created/);
    expect(await createTestUser(db, { username: "Ethan", password: "other password" })).toMatch(/already exists/);
    const { rows } = await pg.query<{ password_hash: string }>("SELECT password_hash FROM users");
    expect(rows).toHaveLength(1);
    expect(await verifyPassword("first password", rows[0]!.password_hash)).toBe(true);
  });
});
