import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/..." alias as tsconfig.json and Next.js.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Logic tests run in Node. Component tests opt into a browser-like DOM with
    // a `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    // e2e/ holds Playwright specs (`npm run test:e2e`), not Vitest tests.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
