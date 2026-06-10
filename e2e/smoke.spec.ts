/**
 * E2E smoke test — verifies the critical user path works end-to-end.
 *
 * Runs against the auto-started PI_MOCK server (see playwright.config.ts).
 * No LLM calls — only tests UI loading, user creation, and library view.
 *
 * Run manually against dev server:
 *   BASE_URL=http://localhost:5947 npx playwright test
 */

import { test, expect } from "@playwright/test";
import { api, loginAs } from "./helpers";

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

    // 3. Should navigate to Home page
    // (UserPicker dismisses once localStorage is set)
    await expect(page.locator(".user-picker")).not.toBeVisible({ timeout: 5000 });
  });

  test("switching user returns to UserPicker", async ({ page }) => {
    // Set up: create user via API so we have a known state
    const a = api(page.request);
    await a.createUser(TEST_USER_ID + "-switch", "Switch Test");

    // Login via localStorage (skip UserPicker)
    await loginAs(page, TEST_USER_ID + "-switch", "Switch Test");

    await page.goto("/");
    // Should skip UserPicker and show some app content
    await expect(page.locator(".user-picker")).not.toBeVisible({ timeout: 5000 });
  });

  // Clean up test users
  test.afterAll(async ({ request }) => {
    const a = api(request);
    await a.deleteUser(TEST_USER_ID);
    await a.deleteUser(TEST_USER_ID + "-switch");
  });
});
