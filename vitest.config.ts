import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Same "@/..." alias as tsconfig.json and Next.js.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws unless bundled for the server (the "react-server"
      // condition). Tests run server code directly, so use its empty module.
      // src/db/boundary.test.ts checks client code doesn't import `@/db`.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    // Logic tests run in Node. Component tests opt into a browser-like DOM with
    // a `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    // e2e/ holds Playwright specs (`npm run test:e2e`), not Vitest tests.
    // .claude/ holds Claude Code agent worktrees: full copies of the repo on
    // other branches, whose tests would otherwise run (and fail) here too.
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
  },
});
