// What a script prints when it fails (#110, audit L12). A failed drizzle query's
// message is the SQL followed by every parameter, and for the seed's puzzle
// upsert those are the private answers: pasted into an issue or PR, it would
// put daily answers on the public repo. So for a query error this prints only
// the table it was working on and the database's own error (in `cause`:
// a missing table, a wrong password, a broken constraint), never the params.
//
// Runs directly in Node 24 (type stripping), so imports keep their `.ts`.

/** A drizzle query error (DrizzleQueryError): it carries the SQL and its parameters. */
function isQueryError(error: unknown): error is Error & { query: string } {
  return error instanceof Error && typeof (error as { query?: unknown }).query === "string" && "params" in error;
}

/** The first table a query names (`insert into "puzzles"`, `update "packs"`, `from "games"`), if any. */
export function tableOf(query: string): string | null {
  const match = /\b(?:into|update|from)\s+"?([a-z_][a-z0-9_]*)"?/iu.exec(query);
  return match?.[1] ?? null;
}

/** The lines to print for `error` and up to four causes beneath it, with no query parameters. */
export function errorLines(error: unknown): string[] {
  const lines: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    let message: string;
    if (isQueryError(current)) {
      const table = tableOf(current.query);
      message = `A database query failed${table ? ` (table ${table})` : ""}. Its parameters aren't shown: they can include answers.`;
    } else {
      message = current instanceof Error ? current.message : String(current);
    }
    lines.push(depth === 0 ? message : `Caused by: ${message}`);
    current = current instanceof Error ? current.cause : undefined;
  }
  return lines;
}
