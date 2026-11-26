import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Only server code talks to the database (#47). src/db/boundary.test.ts also
  // checks "use client" files elsewhere.
  {
    files: ["src/components/**", "src/game/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*", "**/db", "**/db/*"],
              message: "Client and game-logic code must not import the database. Use a Server Component, Server Action or Route Handler.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code agent worktrees: full copies of the repo on other branches
    ".claude/**",
    // Playwright output
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
]);

export default eslintConfig;
