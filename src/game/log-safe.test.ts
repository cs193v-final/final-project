import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { errorForLog } from "./log-safe.ts";

const SECRET_PARAM = "owner-hash-1234";
const GUESS = "my secret guess";

function postgresError(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "users_username"'), {
    name: "NeonDbError",
    code: "23505",
    detail: `Key (username)=(${GUESS}) already exists.`,
  });
}

describe("errorForLog", () => {
  it("keeps a failed query's SQL, error names and Postgres code, but not its parameters or detail", () => {
    const error = new DrizzleQueryError('select * from "games" where "owner" = $1', [SECRET_PARAM, GUESS], postgresError());
    const logged = errorForLog(error);

    expect(logged).toEqual({
      name: error.name,
      message: "Failed query",
      query: 'select * from "games" where "owner" = $1',
      cause: {
        name: "NeonDbError",
        message: 'duplicate key value violates unique constraint "users_username"',
        code: "23505",
      },
    });
    const text = JSON.stringify(logged);
    expect(text).not.toContain(SECRET_PARAM);
    expect(text).not.toContain(GUESS);
  });

  it("keeps an ordinary error's name and message", () => {
    expect(errorForLog(new TypeError("boom"))).toEqual({ name: "TypeError", message: "boom" });
  });

  it("doesn't log a thrown non-Error value, which could be anything", () => {
    expect(errorForLog({ password: "hunter2" })).toEqual({ name: "object", message: "non-Error value thrown" });
    expect(JSON.stringify(errorForLog("hunter2"))).not.toContain("hunter2");
  });

  it("stops following a cycle of causes", () => {
    const a = new Error("a");
    a.cause = a;
    let depth = 0;
    for (let e = errorForLog(a); e.cause; e = e.cause) depth++;
    expect(depth).toBe(5);
  });
});
