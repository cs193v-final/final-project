// TLS check for database connection strings (#60). Pure and dependency-free,
// so both the app's client (src/db/index.ts) and drizzle.config.ts can use it.
//
// Every connection must require TLS: `sslmode=require`, `verify-ca` or
// `verify-full`. A missing `sslmode`, or `disable`, `allow` or `prefer`, is
// rejected, because libpq's default (`prefer`) silently falls back to plain
// text. The one exception is a database on this machine (localhost, 127.0.0.1
// or ::1), such as the Postgres service container in CI: traffic there never
// leaves the machine, so it may connect without TLS.
//
// Error messages name the variable and the reason, never the connection string,
// so they can't leak a password into logs.

/** `sslmode` values that refuse to connect without TLS. */
export const TLS_SSLMODES: readonly string[] = ["require", "verify-ca", "verify-full"];

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1", "[::1]"];

export class InsecureDatabaseUrlError extends Error {
  constructor(variable: string, reason: string) {
    super(
      `${variable} must require TLS: ${reason}. Add sslmode=require (or verify-ca / verify-full) to the connection string. ` +
        "Only a database on localhost may connect without TLS.",
    );
    this.name = "InsecureDatabaseUrlError";
  }
}

/** True when every host the URL names is a loopback address. */
function isLoopbackOnly(hosts: string[]): boolean {
  return hosts.length > 0 && hosts.every((h) => LOOPBACK_HOSTS.includes(h));
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

  // libpq allows several comma-separated hosts, and a `host` query parameter
  // that overrides the one in the authority. Every host counts.
  const hostParams = parsed.searchParams.getAll("host");
  const hosts = (hostParams.length > 0 ? hostParams : [parsed.hostname])
    .flatMap((h) => h.split(","))
    .map((h) => h.trim().toLowerCase().replace(/^([^:]+|\[[^\]]*\]):\d+$/, "$1"))
    .filter((h) => h !== "");
  if (isLoopbackOnly(hosts)) return;

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
