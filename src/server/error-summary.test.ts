import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { EncryptionKeyError } from "../crypto/vault.ts";
import { errorSummary } from "./error-summary.ts";

const USERNAME = "ethan";
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA";

function duplicateUser(): DrizzleQueryError {
  const pg = Object.assign(new Error(`duplicate key value violates unique constraint "users_username"`), {
    name: "NeonDbError",
    code: "23505",
    detail: `Key (username)=(${USERNAME}) already exists.`,
  });
  return new DrizzleQueryError('insert into "users" ("username", "password_hash") values ($1, $2)', [USERNAME, HASH], pg);
}

describe("errorSummary", () => {
  it("never includes a failed query's parameters, Postgres detail or message", () => {
    const line = errorSummary(duplicateUser());
    expect(line).toBe("Error: Failed query; caused by NeonDbError (23505)");
    expect(line).not.toContain(USERNAME);
    expect(line).not.toContain(HASH);
  });

  it("keeps a message that carries no values, such as a missing encryption key's", () => {
    const missing = new EncryptionKeyError("DATA_ENCRYPTION_KEY is not set. See README.md.");
    expect(errorSummary(missing)).toBe("EncryptionKeyError: DATA_ENCRYPTION_KEY is not set. See README.md.");
  });

  it("shows the network error under Neon's fetch failure", () => {
    const neon = Object.assign(new Error("Error connecting to database: fetch failed"), {
      name: "NeonDbError",
      sourceError: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    expect(errorSummary(neon)).toBe("NeonDbError; caused by Error (ECONNREFUSED): connect ECONNREFUSED");
  });

  it("describes a thrown non-Error without its value", () => {
    expect(errorSummary(HASH)).toBe("string: non-Error value thrown");
  });
});
