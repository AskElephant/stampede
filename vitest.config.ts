import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "examples/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
    typecheck: {
      enabled: true,
    },
  },
});
