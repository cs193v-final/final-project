// TLS check for database connection strings (#60). Pure and dependency-free,
// so both the app's client (src/db/index.ts) and drizzle.config.ts can use it.
//
// Every connection must require TLS: `sslmode=require`, `verify-ca` or
// `verify-full`. A missing `sslmode`, or `disable`, `allow` or `prefer`, is
// rejected, because libpq's default (`prefer`) silently falls back to plain
// text. The one exception is a database on this machine (localhost, 127.0.0.0/8
// or ::1), such as the Postgres service container in CI: traffic there never
// leaves the machine, so it may connect without TLS.
//
// The same loopback rule picks the driver in src/db/index.ts and
// scripts/seed-db.ts (node-postgres for loopback, Neon otherwise), so a
// database that is exempt from TLS is always one reached with `pg`.
//
// Error messages name the variable and the reason, never the connection string,
// so they can't leak a password into logs.

/** `sslmode` values that refuse to connect without TLS. */
export const TLS_SSLMODES: readonly string[] = ["require", "verify-ca", "verify-full"];

export class InsecureDatabaseUrlError extends Error {
  constructor(variable: string, reason: string) {
    super(
      `${variable} must require TLS: ${reason}. Add sslmode=require (or verify-ca / verify-full) to the connection string. ` +
        "Only a database on localhost may connect without TLS.",
    );
    this.name = "InsecureDatabaseUrlError";
  }
}

/** `localhost`, anything in `127.0.0.0/8`, or `::1` (with or without brackets). Case-insensitive. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  if (host === "localhost" || host === "::1") return true;
  const octets = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  return octets !== null && octets.slice(1).every((n) => Number(n) <= 255);
}

/**
 * Every host a connection URL names, lowercased and without ports. libpq
 * allows several comma-separated hosts, and a `host` query parameter that
 * overrides the one in the authority; every host counts.
 */
function hostsOf(parsed: URL): string[] {
  const hostParams = parsed.searchParams.getAll("host");
  return (hostParams.length > 0 ? hostParams : [parsed.hostname])
    .flatMap((h) => h.split(","))
    .map((h) => h.trim().toLowerCase().replace(/^([^:]+|\[[^\]]*\]):\d+$/u, "$1"))
    .filter((h) => h !== "");
}

/** True when every host the URL names is a loopback address. */
function isLoopbackOnly(hosts: string[]): boolean {
  return hosts.length > 0 && hosts.every(isLoopbackHost);
}

/**
 * True when every host in a postgres URL is on this machine: the URL may skip
 * TLS, and the app and the seed script use node-postgres for it. False for
 * anything that isn't a URL (the TLS check reports those).
 */
export function isLoopbackDatabaseUrl(url: string): boolean {
  try {
    return isLoopbackOnly(hostsOf(new URL(url)));
  } catch {
    return false;
  }
}

/**
 * Throws `InsecureDatabaseUrlError` unless `url` is a `postgres://` or
 * `postgresql://` URL that requires TLS, or one whose hosts are all loopback.
 * `variable` is only used in the error message.
 */
export function assertDatabaseUrlRequiresTls(url: string, variable = "DATABASE_URL"): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // URL's own error message contains the input, so don't pass it on.
    throw new InsecureDatabaseUrlError(variable, "it is not a valid postgres:// or postgresql:// URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new InsecureDatabaseUrlError(variable, "it is not a postgres:// or postgresql:// URL");
  }

  if (isLoopbackOnly(hostsOf(parsed))) return;

  const modes = parsed.searchParams.getAll("sslmode");
  if (modes.length === 0) {
    throw new InsecureDatabaseUrlError(variable, "sslmode is missing (the default, prefer, falls back to no TLS)");
  }
  const weak = modes.find((m) => !TLS_SSLMODES.includes(m));
  if (weak !== undefined) {
    // Only echo values we know, never arbitrary text from the URL.
    const shown = ["disable", "allow", "prefer", "no-verify"].includes(weak) ? `sslmode=${weak}` : "this sslmode";
    throw new InsecureDatabaseUrlError(variable, `${shown} allows a connection without TLS`);
  }
}
