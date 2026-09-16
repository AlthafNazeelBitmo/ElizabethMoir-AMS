import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests run against workspace source, so no package needs building first.
    alias: {
      "@ams/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
