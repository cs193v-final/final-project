// Security headers for every response (#105, audit finding M7). No imports,
// so next.config.ts can load it.
//
// Content-Security-Policy: Next's "without nonces" policy. Nonces would need
// every page rendered per request, and Cache Components (partial
// prerendering) serves a static shell that can't carry one, so scripts are
// limited to our own origin plus Next's inline bootstrap ('unsafe-inline').
// A nonce or hash-based script policy can follow. Styles allow inline
// because React renders `style={...}` as style attributes (ImageViewer).
// `frame-ancestors 'none'` stops other sites framing the app (clickjacking),
// which matters for the login and sign-up forms.

/** The CSP, one directive per entry. Development adds 'unsafe-eval', which React's dev tooling needs. */
export function contentSecurityPolicy(isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** HSTS for two years. Browsers ignore it over plain http, so local dev and e2e aren't affected. */
export const HSTS = "max-age=63072000; includeSubDomains";

export function securityHeaders(isDev: boolean): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Strict-Transport-Security", value: HSTS },
    // Older browsers that don't know frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
