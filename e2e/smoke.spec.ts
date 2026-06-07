/**
 * E2E smoke test — verifies the critical user path works end-to-end.
 *
 * Runs against a live server (Docker container in CI, dev server locally).
 * No LLM calls — only tests UI loading, user creation, and library view.
 *
 * Run locally:
 *   npm run dev          # start dev server
 *   BASE_URL=http://localhost:5947 npx playwright test
 */

import { test, expect } from "@playwright/test";

// Clean up test user after each run
const TEST_USER_ID = `e2e-smoke-${Date.now()}`;

test.describe("Smoke", () => {
  test("app loads → create user → library renders", async ({ page }) => {
    // 1. App loads and shows UserPicker
    await page.goto("/");
    await expect(page.locator(".user-picker")).toBeVisible();
    await expect(page.locator("text=Who's reading?")).toBeVisible();

    // 2. Fill in the create user form
    await page.fill('input[placeholder="e.g. alice"]', TEST_USER_ID);
    await page.fill('input[placeholder*="Alice Chen"]', "E2E Tester");
    await page.click("text=Get Started");

    // 3. Should navigate to Library
    await expect(page.locator(".library")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".library-header")).toBeVisible();

    // 4. User pill shows in the header
    await expect(page.locator(".library-user-pill")).toBeVisible();
  });

  test("switching user returns to UserPicker", async ({ page }) => {
    // Set up: create user via API so we have a known state
    const baseURL = page.url().replace(/\/$/, "") || "http://localhost:3847";
    await page.request.post(`${baseURL}/api/users`, {
      data: { id: TEST_USER_ID + "-switch", displayName: "Switch Test" },
    });

    // Login via localStorage (skip UserPicker)
    await page.addInitScript((userId: string) => {
      localStorage.setItem("pi-books-user-id", userId);
      localStorage.setItem("pi-books-display-name", "Switch Test");
    }, TEST_USER_ID + "-switch");

    await page.goto("/");
    await expect(page.locator(".library")).toBeVisible({ timeout: 5000 });

    // Click user pill to switch user
    await page.click(".library-user-pill");

    // Should return to UserPicker
    await expect(page.locator(".user-picker")).toBeVisible({ timeout: 5000 });
  });

  // Clean up test users
  test.afterAll(async ({ request }) => {
    const baseURL = process.env.BASE_URL ?? "http://localhost:3847";
    try {
      await request.delete(`${baseURL}/api/users/${TEST_USER_ID}`);
      await request.delete(`${baseURL}/api/users/${TEST_USER_ID}-switch`);
    } catch {
      // Best effort cleanup
    }
  });
});
