// Where to go after logging in (#132, #134). The login page carries a `next`
// path (`/login?next=/account`), and after a successful login or sign-up the
// server action redirects there. `next` comes from the URL, so anyone can put
// anything in it: only a path on our own site is followed, never another site
// (an "open redirect" a phishing link could use).
//
// No React or Next imports, so the rules are unit-tested directly.

/** Where you land when there's no usable `next`: the home screen (#132). */
export const DEFAULT_NEXT = "/";

const MAX_LENGTH = 512;
const BASE = "http://zoom-out.invalid";

/**
 * `value` if it's a path on this site, else `/`. A safe path starts with one
 * `/` and has no backslashes, whitespace or control characters: browsers read
 * `//evil.com` and `/\evil.com` as another host, and drop tabs and newlines,
 * so `/\t/evil.com` becomes `//evil.com`. As a last check it must resolve to
 * our own origin. The login and sign-up pages themselves go home instead, so
 * logging in never lands back on a login form.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_LENGTH) return DEFAULT_NEXT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_NEXT;
  // Backslash, any whitespace (including Unicode spaces) and control characters.
  if (/[\\\s\p{Cc}]/u.test(value)) return DEFAULT_NEXT;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== BASE) return DEFAULT_NEXT;
  if (url.pathname === "/login" || url.pathname === "/register") return DEFAULT_NEXT;
  const path = url.pathname + url.search + url.hash;
  // Resolving dot segments can make a new `//`: `/..//evil.com` is `//evil.com`.
  return path.startsWith("//") ? DEFAULT_NEXT : path;
}

/** The login page, set to come back to `next` (if it's a safe path other than home). */
export function loginPath(next?: string): string {
  const safe = safeNextPath(next);
  return safe === DEFAULT_NEXT ? "/login" : `/login?next=${encodeURIComponent(safe)}`;
}

/** Which confirmation to show after the redirect (see `withWelcome`). */
export type Welcome = "login" | "signup";

/** The query parameter that asks the header to say "Logged in as …" once. */
export const WELCOME_PARAM = "welcome";

/**
 * `path` with `?welcome=login|signup` added, so the page you land on can
 * confirm the login once (the header's `WelcomeStatus` reads it, then removes
 * it from the URL). `path` must already be safe.
 */
export function withWelcome(path: string, welcome: Welcome): string {
  const url = new URL(path, BASE);
  url.searchParams.set(WELCOME_PARAM, welcome);
  return url.pathname + url.search + url.hash;
}

/** `?welcome=` parsed, or `null` for a missing or unknown value. */
export function parseWelcome(value: string | null | undefined): Welcome | null {
  return value === "login" || value === "signup" ? value : null;
}
