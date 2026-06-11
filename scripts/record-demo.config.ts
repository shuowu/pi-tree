import { defineConfig } from "@playwright/test";

/**
 * Minimal Playwright config for the demo recording script.
 * Expects BASE_URL to point at a running dev server (e.g., http://localhost:5947).
 */
export default defineConfig({
  testDir: ".",
  testMatch: "scripts/{record-demo,take-screenshots}.ts",
  timeout: 120_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:5947",
    channel: "chrome",
  },
  projects: [
    {
      name: "demo",
      use: {
        channel: "chrome",
      },
    },
  ],
});
