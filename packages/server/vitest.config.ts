import { defineConfig } from "vitest/config";
import { join, resolve } from "node:path";

// Resolve workspace packages to TypeScript source so server tests never
// depend on a stale dist/ build.  Only our own @pi-tree/* packages are
// aliased — third-party node_modules are left alone.
const workspaceRoot = resolve(__dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@pi-tree/core/types": resolve(workspaceRoot, "packages/core/src/types/index.ts"),
      "@pi-tree/core/session": resolve(workspaceRoot, "packages/core/src/session/index.ts"),
      "@pi-tree/core": resolve(workspaceRoot, "packages/core/src/index.ts"),
      "@pi-tree/shared": resolve(workspaceRoot, "packages/shared/src/index.ts"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Use a per-process temp dir so parallel runs don't collide
    env: {
      DATA_PATH: join("/tmp", `pi-tree-test-${process.pid}`),
    },
  },
});
