import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { errorForLog, type LoggedError } from "./log-safe.ts";

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
      stack: expect.any(Array),
      cause: { name: "NeonDbError", code: "23505", stack: expect.any(Array) },
    });
    const text = JSON.stringify(logged);
    expect(text).not.toContain(SECRET_PARAM);
    expect(text).not.toContain(GUESS);
  });

  it("keeps an ordinary error's name and message", () => {
    expect(errorForLog(new TypeError("boom"))).toMatchObject({ name: "TypeError", message: "boom" });
  });

  it("logs only the name and code of an error with a Postgres code, whose message can quote a value", () => {
    const cause = Object.assign(new Error(`invalid input syntax for type uuid: "${GUESS}"`), { name: "NeonDbError", code: "22P02" });
    const logged = errorForLog(new Error("loading the game failed", { cause }));
    expect(logged.message).toBe("loading the game failed");
    expect(logged.cause).toEqual({ name: "NeonDbError", code: "22P02", stack: expect.any(Array) });
    expect(JSON.stringify(logged)).not.toContain(GUESS);
  });

  it("drops a SyntaxError's message, since JSON.parse quotes its input (stored state, guesses included)", () => {
    let error: unknown;
    try {
      JSON.parse(`{"guess": ${GUESS}}`); // V8 quotes the input around the bad token
    } catch (e) {
      error = e;
    }
    expect(String(error)).toContain("my secret"); // what is at stake
    const logged = errorForLog(error);
    expect(logged).toEqual({ name: "SyntaxError", stack: expect.any(Array) });
    expect(JSON.stringify(logged)).not.toContain("my secret");
    expect(JSON.stringify(logged)).not.toContain(GUESS);
  });

  it("keeps the stack's `at …` lines, but not its first line, which repeats the message", () => {
    const error = new DrizzleQueryError("select 1", [SECRET_PARAM], new Error("x"));
    expect(error.stack).toContain(SECRET_PARAM);
    const { stack } = errorForLog(error);
    expect(stack?.length).toBeGreaterThan(0);
    for (const line of stack ?? []) expect(line).toMatch(/^at /u);
    expect(stack?.join("\n")).toContain("log-safe.test.ts");
    expect(JSON.stringify(stack)).not.toContain(SECRET_PARAM);
  });

  it("doesn't mistake a message line starting with `at ` for a stack frame", () => {
    const error = Object.assign(new Error(`line one\n    at ${GUESS}`), { code: "22P02" });
    expect(JSON.stringify(errorForLog(error))).not.toContain(GUESS);
  });

  it("doesn't keep a message line as a frame when the message changed after the error was thrown", () => {
    // The stack still holds the original multi-line message, which no longer
    // matches `message`, so it can't be cut off by position.
    const error = new Error(`line one\n    at ${GUESS}`);
    void error.stack; // V8 formats the stack on first read; read it before the change.
    error.message = `context: ${error.message}`;
    expect(error.stack).toContain(`at ${GUESS}`);
    const { stack } = errorForLog(error);
    expect(stack?.length).toBeGreaterThan(0);
    expect(JSON.stringify(stack)).not.toContain(GUESS);
  });

  it("keeps the message of Node's five-letter errno codes (EPIPE), which aren't Postgres codes", () => {
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(errorForLog(epipe)).toMatchObject({ code: "EPIPE", message: "write EPIPE" });
  });

  it("drops a database driver's message even without a code (Neon's raw HTTP response body)", () => {
    const neon = Object.assign(new Error(`Server error (HTTP status 500): {"query":"${GUESS}"}`), { name: "NeonDbError" });
    const logged = errorForLog(new DrizzleQueryError("select 1", [SECRET_PARAM], neon));
    expect(logged.cause).toEqual({ name: "NeonDbError", stack: expect.any(Array) });
    expect(JSON.stringify(logged)).not.toContain(GUESS);
  });

  it("ignores a null cause or sourceError instead of logging a fake entry", () => {
    const error = Object.assign(new Error("x", { cause: null }), { sourceError: null });
    const logged = errorForLog(error);
    expect(logged.cause).toBeUndefined();
    expect(logged.sourceError).toBeUndefined();
  });

  it("follows Neon's sourceError, so a failed connection shows why (ECONNREFUSED)", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const neon = Object.assign(new Error("Error connecting to database: fetch failed"), {
      name: "NeonDbError",
      sourceError: new TypeError("fetch failed", { cause: refused }),
    });
    const logged = errorForLog(new DrizzleQueryError("select 1", [SECRET_PARAM], neon));
    expect(logged.cause?.sourceError).toMatchObject({
      name: "TypeError",
      message: "fetch failed",
      cause: { name: "Error", code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:5432" },
    });
  });

  it("follows an AggregateError's errors, at most five, by the same rules", () => {
    const errors = Array.from({ length: 8 }, (_, i) =>
      Object.assign(new Error(`connect ECONNREFUSED 10.0.0.${i}:5432`), { code: "ECONNREFUSED" }),
    );
    errors[0] = Object.assign(new Error(`value "${GUESS}"`), { code: "22P02" });
    const logged = errorForLog(new AggregateError(errors, "all hosts failed"));
    expect(logged.message).toBe("all hosts failed");
    expect(logged.errors).toHaveLength(5);
    expect(logged.errors?.[0]).toEqual({ name: "Error", code: "22P02", stack: expect.any(Array) });
    expect(logged.errors?.[1]?.code).toBe("ECONNREFUSED");
    expect(JSON.stringify(logged)).not.toContain(GUESS);
  });

  it("caps the number of errors in one entry, however they nest", () => {
    const wide = (depth: number): Error =>
      new AggregateError(depth === 0 ? [] : Array.from({ length: 5 }, () => wide(depth - 1)), "x");
    let count = 0;
    const walk = (e: LoggedError) => {
      count++;
      e.errors?.forEach(walk);
    };
    walk(errorForLog(wide(4)));
    expect(count).toBeLessThanOrEqual(20);
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
