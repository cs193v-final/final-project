import type { NextConfig } from "next";

import { securityHeaders } from "./src/server/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Don't advertise the framework (#105).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "development") }];
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

export default nextConfig;
