import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { securityHeaders } from "./src/server/security-headers";

// A function, so the CSP follows the server that's actually running (`next
// dev` gets the dev policy), not whatever NODE_ENV happens to be set (#105).
export default function nextConfig(phase: string): NextConfig {
  return {
    /* config options here */
    cacheComponents: true,
    partialPrefetching: true,
    // Don't advertise the framework (#105).
    poweredByHeader: false,
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders(phase === PHASE_DEVELOPMENT_SERVER) }];
    },
    turbopack: {
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
  };
}
