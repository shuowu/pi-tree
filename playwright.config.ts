import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  retries: 0,
  use: {
    // Default: Docker container port. Override with BASE_URL env var for dev.
    baseURL: process.env.BASE_URL ?? "http://localhost:3847",
    // Headless by default, no screenshots/videos to keep it lean
    screenshot: "off",
    video: "off",
  },
  // No webServer config — expects the server to already be running
  // (Docker container in CI, or `npm run dev` locally)
});
