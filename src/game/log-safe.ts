/**
 * What the server logs about an unexpected error, without the values in it (#60).
 *
 * A failed drizzle query (`DrizzleQueryError`) carries the query's parameters
 * in `params` and in its message ("Failed query: ... params: ..."), and the
 * Postgres error under it can quote values in `detail`
 * ("Key (username)=(bob) already exists."). Those can be an owner hash, a
 * player's guess or, for accounts, a password hash, so they never reach the
 * logs. The SQL text, error names, messages and Postgres codes stay: they're
 * what's needed to debug, and the SQL only has `$1` placeholders.
 *
 * Duck-typed so this module stays free of database imports.
 */
export type LoggedError = {
  name: string;
  message: string;
  code?: string;
  query?: string;
  cause?: LoggedError;
};

const MAX_CAUSE_DEPTH = 5;

export function errorForLog(error: unknown, depth = 0): LoggedError {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: "non-Error value thrown" };
  }
  const e = error as Error & { query?: unknown; params?: unknown; code?: unknown };
  const isQueryError = typeof e.query === "string" && "params" in e;
  const logged: LoggedError = {
    name: e.name,
    // drizzle puts the params into the message, so rebuild it from the query alone.
    message: isQueryError ? "Failed query" : e.message,
  };
  if (typeof e.code === "string") logged.code = e.code;
  if (isQueryError) logged.query = e.query as string;
  if (e.cause !== undefined && depth < MAX_CAUSE_DEPTH) logged.cause = errorForLog(e.cause, depth + 1);
  return logged;
}
