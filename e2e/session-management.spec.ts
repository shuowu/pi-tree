/**
 * E2E: Multi-session management.
 *
 * Tests the session lifecycle through the UI:
 *   - Navigate to sessions page
 *   - Create multiple sessions via the SessionPicker
 *   - Verify sessions appear in the list
 *   - Rename a session
 *   - Delete a session
 *   - Switch between sessions
 *
 * Requires: PI_MOCK=true (Playwright config handles this via webServer).
 */

import { test, expect } from "@playwright/test";
import { api, loginAs, sel } from "./helpers";

const RUN_ID = Date.now();
const TEST_USER = `e2e-sessions-${RUN_ID}`;
const TEST_SOURCE = "e2e-sessions-book";

test.describe("Session management", () => {
  // Tests build on each other's state — create then rename then delete
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ request }) => {
    const a = api(request);
    await a.createUser(TEST_USER, "E2E Sessions");
    await a.seedSource(TEST_SOURCE, "Sessions Test Book", { author: "Test" });
  });

  test.afterAll(async ({ request }) => {
    await api(request).deleteUser(TEST_USER);
  });

  test("sessions page shows SessionPicker when no sessions exist", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Sessions");
    await page.goto(`/source/${TEST_SOURCE}/sessions`);

    // SessionPicker should be visible with source title
    await expect(page.locator(".session-picker")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".session-picker-title")).toContainText("Sessions Test Book");
  });

  test("can create a reading session via mode picker", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Sessions");
    await page.goto(`/source/${TEST_SOURCE}/sessions`);

    await expect(page.locator(".session-picker")).toBeVisible({ timeout: 10_000 });

    // Click "Interactive Reading" mode option
    const readingBtn = page.locator(".session-picker-mode-option", {
      hasText: /reading/i,
    }).first();
    await readingBtn.click();

    // Should navigate to the reader with the new session
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 15_000 });
  });

  test("can create a second session and both appear in sessions list", async ({ page, request }) => {
    // Create a second session via API
    const a = api(request);
    await a.createSession(TEST_USER, TEST_SOURCE, "My Q&A Session", { mode: "qa" });

    await loginAs(page, TEST_USER, "E2E Sessions");
    await page.goto(`/source/${TEST_SOURCE}/sessions`);

    // Wait for session list to load
    await expect(page.locator(".session-picker")).toBeVisible({ timeout: 10_000 });

    // Should see at least 2 session cards (reading + qa)
    const cards = page.locator(".session-card");
    await expect(cards).toHaveCount(2, { timeout: 5_000 });
  });

  test("can rename a session", async ({ page, request }) => {
    // First, get the sessions so we know what's there
    await loginAs(page, TEST_USER, "E2E Sessions");
    await page.goto(`/source/${TEST_SOURCE}/sessions`);

    await expect(page.locator(".session-picker")).toBeVisible({ timeout: 10_000 });

    // Hover over a session card to reveal the action buttons
    const firstCard = page.locator(".session-card").first();
    await firstCard.hover();

    // Click the rename/edit button
    const renameBtn = firstCard.locator(".session-card-action-btn").first();
    await renameBtn.click();

    // The edit input should appear
    const editInput = firstCard.locator(".session-card-edit-input");
    await expect(editInput).toBeVisible({ timeout: 3_000 });

    // Clear and type new name
    await editInput.fill("Renamed Session");

    // Confirm (click the save button or press Enter)
    await editInput.press("Enter");

    // The card should now show the renamed title
    await expect(firstCard.locator(".session-card-title")).toContainText(
      "Renamed Session",
      { timeout: 5_000 },
    );
  });

  test("can delete a session", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Sessions");
    await page.goto(`/source/${TEST_SOURCE}/sessions`);

    await expect(page.locator(".session-picker")).toBeVisible({ timeout: 10_000 });

    // Wait for cards to load before counting
    await expect(page.locator(".session-card").first()).toBeVisible({ timeout: 5_000 });
    const cardsBefore = await page.locator(".session-card").count();
    expect(cardsBefore).toBeGreaterThanOrEqual(1);

    // Hover to reveal delete button
    const lastCard = page.locator(".session-card").last();
    await lastCard.hover();

    // Click delete button
    const deleteBtn = lastCard.locator(".session-card-action-delete");
    await deleteBtn.click();

    // Confirm deletion
    const confirmBtn = lastCard.locator(".session-card-delete-yes");
    await confirmBtn.click();

    // Wait for the card to disappear
    await expect(page.locator(".session-card")).toHaveCount(cardsBefore - 1, {
      timeout: 5_000,
    });
  });

  test("clicking a session navigates to the reader", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Sessions");
    await page.goto(`/source/${TEST_SOURCE}/sessions`);

    await expect(page.locator(".session-picker")).toBeVisible({ timeout: 10_000 });

    // Click on the remaining session card
    const card = page.locator(".session-card").first();
    await card.click();

    // Should navigate to the reader with chat view
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 15_000 });

    // URL should contain the source id and session param
    expect(page.url()).toContain(TEST_SOURCE);
  });
});
