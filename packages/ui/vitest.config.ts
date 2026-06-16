import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const workspaceRoot = resolve(__dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@pi-tree/core/types": resolve(workspaceRoot, "packages/core/src/types/index.ts"),
      "@pi-tree/core": resolve(workspaceRoot, "packages/core/src/index.ts"),
      "@pi-tree/shared": resolve(workspaceRoot, "packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false, // Don't process CSS imports
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
