// Whether a request came in over https. No imports, so both cookie modules
// (src/server/owner.ts and src/auth/session.ts) can use it without importing
// each other.

/**
 * Whether the request reached us over https, so a cookie set on it can be
 * `Secure`. On Vercel always (preview and production serve only https, and
 * Vercel sets `VERCEL` on every deployment), whatever the request's headers
 * say (#155). Elsewhere from `X-Forwarded-Proto`: Next sets that header from
 * the connection when a proxy hasn't, so plain `next dev` / `next start`
 * report "http" and a phone on the LAN still gets its cookies. With a proxy
 * chain the first value is the client's. Unknown means https, the safe default.
 */
export function isHttpsRequest(forwardedProto: string | null, onVercel = Boolean(process.env.VERCEL)): boolean {
  if (onVercel) return true;
  const first = forwardedProto?.split(",")[0]?.trim().toLowerCase();
  return first === undefined || first === "" ? true : first === "https";
}
