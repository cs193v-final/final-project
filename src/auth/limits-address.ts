// Whether a request's address counts toward per-address rate limits. Shared by
// login and sign-up (#53, src/auth/accounts.ts) and the game server (#85,
// src/server/games.ts). No imports, so loading it has no side effects.

/**
 * Whether the per-address limits apply. On Vercel always: its edge sets the
 * client's real address. Anywhere else (`next dev`, CI's `next start`), Next
 * fills the address in from the socket, so every request from this machine
 * shares one loopback address, or none; one shared count there would lock all
 * local and e2e runs out of sign-up after 5 accounts an hour. The
 * per-username login limit still applies.
 */
export function limitsAddress(ip: string | null, onVercel = Boolean(process.env.VERCEL)): boolean {
  if (onVercel) return true;
  if (ip === null) return false;
  const address = ip.toLowerCase().replace(/^::ffff:/, "");
  return !(address === "::1" || address === "localhost" || /^127\./.test(address));
}
