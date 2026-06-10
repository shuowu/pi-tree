import { defineConfig } from "vitest/config";
import { join } from "node:path";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Use a per-process temp dir so parallel runs don't collide
    env: {
      DATA_PATH: join("/tmp", `pi-tree-test-${process.pid}`),
    },
  },
});
