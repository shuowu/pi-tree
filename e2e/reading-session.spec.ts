/**
 * E2E: Reading session flow with mocked AI.
 *
 * Tests the full user journey:
 *   Create user → navigate to source → create session →
 *   send message → see streaming → response renders →
 *   send another message → tree updates
 *
 * Requires: PI_MOCK=true (Playwright config handles this via webServer).
 */

import { test, expect } from "@playwright/test";
import { api, loginAs, sel } from "./helpers";

// Unique IDs per test run to avoid collisions
const RUN_ID = Date.now();
const TEST_USER = `e2e-reader-${RUN_ID}`;
const TEST_SOURCE = "e2e-test-book";

test.describe("Reading session (mocked AI)", () => {
  let sessionId: number;

  // Seed test data: user + source + session
  test.beforeAll(async ({ request }) => {
    const a = api(request);

    // Verify server is healthy
    const health = await a.health();
    expect(health.status).toBe("ok");

    // Create test user
    await a.createUser(TEST_USER, "E2E Reader");

    // Seed a source (test-only route — bypasses file upload)
    await a.seedSource(TEST_SOURCE, "E2E Test Book", { author: "Test Author" });

    // Create a session for this source
    const session = await a.createSession(TEST_USER, TEST_SOURCE, "Test Reading", {
      mode: "reading",
    });
    sessionId = session.id;
  });


  // Clean up
  test.afterAll(async ({ request }) => {
    await api(request).deleteUser(TEST_USER);
  });

  test("send message → streaming response appears", async ({ page }) => {
    // Login and navigate directly to the reader with our session
    await loginAs(page, TEST_USER, "E2E Reader");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);

    // Wait for the chat view to render
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });

    // Wait for any initial loading to finish
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Type a message
    await page.fill(sel.chatInput, "Hello, this is a test message");

    // Click send
    await page.click(sel.chatSend);

    // Our user message should appear
    await expect(
      page.locator(`${sel.userMessage} ${sel.messageContent}`).last(),
    ).toContainText("Hello, this is a test message", { timeout: 5_000 });

    // The streaming indicator should appear (the pit-streaming class)
    // and then be replaced by a completed assistant message
    await expect(
      page.locator(`${sel.assistantMessage} ${sel.messageContent}`).last(),
    ).toBeVisible({ timeout: 15_000 });

    // The mock response should contain our default mock text
    await expect(
      page.locator(`${sel.assistantMessage} ${sel.messageContent}`).last(),
    ).toContainText("mock AI assistant", { timeout: 15_000 });

    // Loading should be done — input re-enabled
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 5_000 });
  });

  test("second message creates a new branch in the tree", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Reader");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);

    // Wait for chat view + existing messages to load
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Wait for the first message to be visible (from previous test)
    await expect(
      page.locator(sel.assistantMessage).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Send a follow-up message
    await page.fill(sel.chatInput, "Tell me more about this book");
    await page.click(sel.chatSend);

    // Wait for the response
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Should now have multiple assistant messages
    const assistantMessages = page.locator(sel.assistantMessage);
    const count = await assistantMessages.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("keyboard submit (Enter) works", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Reader");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Type and press Enter (not Shift+Enter)
    await page.fill(sel.chatInput, "Enter key test");
    await page.press(sel.chatInput, "Enter");

    // The message should appear
    await expect(
      page.locator(`${sel.userMessage} ${sel.messageContent}`).last(),
    ).toContainText("Enter key test", { timeout: 5_000 });

    // Wait for response
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });
  });
});
