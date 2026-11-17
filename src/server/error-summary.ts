/**
 * One line about an error for the server log, by the same rule as
 * `errorForLog` (#60): names, Postgres codes and safe messages only, never a
 * query's parameters (a username, a password hash, a token hash). For the
 * account code's log lines, which say what failed in one line.
 *
 * Follows `cause` and, under it, Neon's `sourceError`, so "fetch failed" still
 * shows the network error under it. Leaves out stack frames and SQL text.
 *
 * No `@/` or `server-only` imports: `scripts/create-test-user.ts` runs this
 * under plain Node (type stripping).
 */
import { errorForLog, type LoggedError } from "../game/log-safe.ts";

export function errorSummary(error: unknown): string {
  const parts: string[] = [];
  for (let e: LoggedError | undefined = errorForLog(error); e; e = e.cause ?? e.sourceError) {
    parts.push(`${e.name}${e.code ? ` (${e.code})` : ""}${e.message ? `: ${e.message}` : ""}`);
  }
  return parts.join("; caused by ");
}
