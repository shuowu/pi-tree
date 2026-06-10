/**
 * E2E: Home page — router chat and quick-action chips.
 *
 * The home page at "/" renders a RouterChat (session-router agent)
 * and quick-action chips that navigate to News, Library, etc.
 *
 * Requires: PI_MOCK=true.
 */

import { test, expect } from "@playwright/test";
import { api, loginAs } from "./helpers";

const RUN_ID = Date.now();
const TEST_USER = `e2e-home-${RUN_ID}`;

test.describe("Home page", () => {
  test.beforeAll(async ({ request }) => {
    await api(request).createUser(TEST_USER, "E2E Home");
  });

  test.afterAll(async ({ request }) => {
    await api(request).deleteUser(TEST_USER);
  });

  // ── Layout ──────────────────────────────────────────────────────────────────

  test("renders greeting and router chat input", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Home");
    await page.goto("/");

    // Greeting should contain the display name
    const greeting = page.locator(".home-greeting");
    await expect(greeting).toContainText("E2E Home", { timeout: 5_000 });

    // Router chat input is visible
    const chatInput = page.locator(".router-chat-input");
    await expect(chatInput).toBeVisible({ timeout: 5_000 });
    await expect(chatInput).toHaveAttribute("placeholder", /read|explore/i);
  });

  // ── Quick-action chips ──────────────────────────────────────────────────────

  test("📰 News chip navigates to news source", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Home");
    await page.goto("/");

    const newsChip = page.locator(".home-quick-chip", { hasText: "News" });
    await expect(newsChip).toBeVisible({ timeout: 5_000 });
    await newsChip.click();

    // Should navigate to the news source page
    await page.waitForURL("**/source/news**", { timeout: 5_000 });
  });

  test("📚 Library chip navigates to library", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Home");
    await page.goto("/");

    const libraryChip = page.locator(".home-quick-chip", { hasText: "Library" });
    await expect(libraryChip).toBeVisible({ timeout: 5_000 });
    await libraryChip.click();

    await page.waitForURL("**/library**", { timeout: 5_000 });
  });

  // ── Router chat ─────────────────────────────────────────────────────────────

  test("send message in router chat → AI responds", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Home");
    await page.goto("/");

    const chatInput = page.locator(".router-chat-input");
    await expect(chatInput).toBeVisible({ timeout: 5_000 });

    // Wait for the router session to initialize (input becomes enabled)
    await expect(chatInput).toBeEnabled({ timeout: 10_000 });

    await chatInput.fill("Tell me about the library");
    await page.locator(".router-chat-send").click();

    // Chat should expand and show the user message
    const userMsg = page.locator(".router-msg-user");
    await expect(userMsg.first()).toContainText("Tell me about the library", { timeout: 5_000 });

    // AI response should appear (mock agent responds to anything)
    const assistantMsg = page.locator(".router-msg-assistant");
    await expect(assistantMsg.first()).toBeVisible({ timeout: 15_000 });

    // Input should be re-enabled after streaming
    await expect(chatInput).toBeEnabled({ timeout: 15_000 });
  });

  test("router chat shows recent sessions in Continue section", async ({ page, request }) => {
    // Pre-create a session so it shows up in "Continue"
    const a = api(request);
    await a.seedSource("e2e-home-book", "Home Test Book");
    await a.createSession(TEST_USER, "e2e-home-book", "Reading session");

    await loginAs(page, TEST_USER, "E2E Home");
    await page.goto("/");

    // "Continue" section should appear with at least one session
    const continueSection = page.locator(".home-continue");
    await expect(continueSection).toBeVisible({ timeout: 10_000 });

    const continueTitle = page.locator(".home-continue-title");
    await expect(continueTitle).toContainText("Continue");
  });
});
