import { defineConfig, devices } from "@playwright/test";

/**
 * E2E test configuration.
 *
 * Uses PI_MOCK=true so tests don't need a real LLM. Starts both server
 * and client on dedicated ports (3747/5747) to avoid conflicts with dev
 * (3947/5947) and Docker (3847).
 *
 * Override with BASE_URL env var to point at an already-running server:
 *   BASE_URL=http://localhost:5947 npx playwright test
 */

const SERVER_PORT = 3747;
const CLIENT_PORT = 5747;
const baseURL = process.env.BASE_URL ?? `http://localhost:${CLIENT_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL,
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use system Chrome — Playwright's bundled chromium doesn't support this OS
        channel: "chrome",
      },
    },
  ],

  // Auto-start both server (mock) and client (Vite dev) for e2e tests.
  // Skipped when BASE_URL is provided (e.g., pointing at running dev server).
  ...(!process.env.BASE_URL
    ? {
        webServer: [
          {
            // Start the aimock server
            command: "npx -p @copilotkit/aimock llmock -p 4010 -f ./e2e/fixtures --strict",
            port: 4010,
            reuseExistingServer: true,
            timeout: 30_000,
          },
          {
            // Start the API server
            command: `PORT=${SERVER_PORT} DATA_PATH=/tmp/pi-tree-e2e npx tsx packages/server/src/index.ts`,
            port: SERVER_PORT,
            reuseExistingServer: true,
            timeout: 30_000,
            env: {
              PORT: String(SERVER_PORT),
              DATA_PATH: "/tmp/pi-tree-e2e",
              PI_MODEL: "mock-model",
              PI_PROVIDER: "openai",
              PI_API_KEY: "mock",
              PI_API_TYPE: "openai-completions",
              PI_BASE_URL: "http://127.0.0.1:4010/v1",
            },
          },
          {
            // Start the Vite client (proxies /api → server port)
            command: `VITE_API_PORT=${SERVER_PORT} npx vite --port ${CLIENT_PORT} --strictPort`,
            cwd: "packages/client",
            port: CLIENT_PORT,
            reuseExistingServer: true,
            timeout: 30_000,
            env: {
              VITE_API_PORT: String(SERVER_PORT),
            },
          },
        ],
      }
    : {}),
});
