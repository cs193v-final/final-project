/**
 * What the server logs about an unexpected error, without the values in it (#60).
 *
 * A failed drizzle query (`DrizzleQueryError`) carries the query's parameters
 * in `params` and in its message ("Failed query: ... params: ..."), and the
 * Postgres error under it can quote values in `detail`
 * ("Key (username)=(bob) already exists.") and in its message
 * (`invalid input syntax for type uuid: "..."`). Those can be an owner hash, a
 * player's guess or, for accounts, a password hash, so they never reach the
 * logs. The rules:
 *
 * - A query error (it has `query` and `params`): name, the SQL text (only `$1`
 *   placeholders) and the fixed message "Failed query".
 * - An error with a Postgres code (a five-character SQLSTATE like `22P02`):
 *   name and code only, never its message or `detail`.
 * - A `SyntaxError`: name only. `JSON.parse` quotes part of its input, which
 *   can be stored game state.
 * - A database driver's error (`NeonDbError`, pg's `DatabaseError`): name and
 *   code only, even without a code. Neon puts the raw HTTP response body in
 *   the message for any status but 400.
 * - Any other error: name and message.
 * - Every error keeps its stack frames (`at …` lines ending in a file
 *   position, `<anonymous>` or `index N`), but not the stack's first line,
 *   which repeats the message.
 * - `cause`, Neon's `sourceError` (the network error under "fetch failed") and
 *   `AggregateError.errors` are followed by the same rules, to a bounded depth
 *   and count.
 *
 * Duck-typed so this module stays free of database imports.
 */
export type LoggedError = {
  name: string;
  /** Left out when it could quote a value (see above). */
  message?: string;
  code?: string;
  query?: string;
  /** The stack's `at …` lines. */
  stack?: string[];
  cause?: LoggedError;
  /** Neon's `NeonDbError.sourceError`, e.g. the `ECONNREFUSED` under "fetch failed". */
  sourceError?: LoggedError;
  /** `AggregateError.errors` (the first `MAX_AGGREGATE_ERRORS`). */
  errors?: LoggedError[];
};

const MAX_CAUSE_DEPTH = 5;
const MAX_AGGREGATE_ERRORS = 5;
/** Total errors in one log entry, however they nest. */
const MAX_ERRORS = 20;

/**
 * Postgres's SQLSTATE codes are five digits or capital letters (`23505`,
 * `22P02`). No SQLSTATE class starts with E, so Node's five-letter errno codes
 * (`EPIPE`, `EPERM`, `EBUSY`) keep their message.
 */
const POSTGRES_CODE = /^(?!E)[0-9A-Z]{5}$/u;

/** Database drivers' error classes, whose messages can quote values or a raw response body. */
const DRIVER_ERRORS = new Set(["NeonDbError", "DatabaseError"]);

/** A stack frame: `at …` ending in a file position, `<anonymous>` or `index N`, with or without `)`. */
const STACK_FRAME = /^at .*(?::\d+:\d+|<anonymous>|index \d+)\)?$/u;

export function errorForLog(error: unknown): LoggedError {
  return toLogged(error, 0, { left: MAX_ERRORS });
}

function toLogged(error: unknown, depth: number, budget: { left: number }): LoggedError {
  budget.left--;
  if (!(error instanceof Error)) {
    return { name: typeof error, message: "non-Error value thrown" };
  }
  const e = error as Error & { query?: unknown; params?: unknown; code?: unknown; sourceError?: unknown; errors?: unknown };
  const isQueryError = typeof e.query === "string" && "params" in e;
  const code = typeof e.code === "string" ? e.code : undefined;

  const logged: LoggedError = { name: e.name };
  if (isQueryError) {
    // drizzle puts the params into the message, so use a fixed one.
    logged.message = "Failed query";
  } else if (!(code !== undefined && POSTGRES_CODE.test(code)) && e.name !== "SyntaxError" && !DRIVER_ERRORS.has(e.name)) {
    logged.message = e.message;
  }
  if (code !== undefined) logged.code = code;
  if (isQueryError) logged.query = e.query as string;

  const frames = stackFrames(e);
  if (frames.length > 0) logged.stack = frames;

  const follow = (next: unknown): LoggedError | undefined =>
    next != null && depth < MAX_CAUSE_DEPTH && budget.left > 0 ? toLogged(next, depth + 1, budget) : undefined;

  const cause = follow(e.cause);
  if (cause) logged.cause = cause;
  const source = follow(e.sourceError);
  if (source) logged.sourceError = source;
  if (Array.isArray(e.errors)) {
    const errors = (e.errors as unknown[])
      .slice(0, MAX_AGGREGATE_ERRORS)
      .map(follow)
      .filter((x): x is LoggedError => x !== undefined);
    if (errors.length > 0) logged.errors = errors;
  }
  return logged;
}

/**
 * Only the stack frames. The stack starts with "Name: message", and the
 * message can span several lines, so everything up to the end of the message
 * is cut off first. If the message isn't in the stack (it was changed after
 * the error was thrown), only lines shaped like real frames are kept, so a
 * message line starting with "at " still isn't mistaken for one.
 */
function stackFrames(e: Error): string[] {
  let stack = e.stack;
  if (typeof stack !== "string") return [];
  const end = e.message ? stack.indexOf(e.message) : -1;
  if (end >= 0) stack = stack.slice(end + e.message.length);
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => STACK_FRAME.test(line));
}
