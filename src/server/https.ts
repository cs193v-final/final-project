// Whether a request came in over https. No imports, so both cookie modules
// (src/server/owner.ts and src/auth/session.ts) can use it without importing
// each other.

/**
 * Whether the request reached us over https, from `X-Forwarded-Proto`. Next
 * sets that header from the connection when a proxy (e.g. Vercel) hasn't, so
 * plain `next dev` / `next start` report "http". With a proxy chain the
 * first value is the client's. Unknown means https, the safe default.
 */
export function isHttpsRequest(forwardedProto: string | null): boolean {
  const first = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  return first === undefined || first === "" ? true : first === "https";
}
