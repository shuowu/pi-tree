import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration — delegates test execution to each package's
 * own vitest.config.ts via the `projects` array.  This ensures that
 * package-specific settings (jsdom for UI/client, node for server,
 * aliases, env vars) are applied correctly when running
 * `npx vitest run` from the repo root.
 *
 * Packages without a vitest.config.ts (core, plugins) are included
 * inline with sensible defaults.
 */
export default defineConfig({
  test: {
    projects: [
      // Packages with their own vitest config (environment, aliases, etc.)
      "packages/server",
      "packages/ui",
      "packages/client",

      // Packages that have tests but no vitest config — use node defaults
      {
        test: {
          name: "core",
          root: "packages/core",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "plugin-book",
          root: "packages/plugin-book",
          include: ["**/__tests__/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "plugin-paper",
          root: "packages/plugin-paper",
          include: ["__tests__/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "plugin-youtube",
          root: "packages/plugin-youtube",
          include: ["__tests__/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "plugin-news",
          root: "packages/plugin-news",
          include: ["__tests__/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      },
    ],
  },
});
