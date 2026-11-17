// The rows of a `db.execute` result (#54, #58). Every driver we use (Neon HTTP,
// node-postgres, PGlite) returns `{ rows }`; anything else is a bug to see, not
// an empty result to hide (review of #121). No "server-only" import, so tests
// and scripts can use it; relative imports keep `.ts`.
export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  throw new Error("unexpected result from db.execute");
}
