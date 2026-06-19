/**
 * E2E: News domain — tests news-specific UI on top of the session view.
 *
 * Session creation is handled via API (domain-agnostic, already tested).
 * These tests focus on what's unique to the news domain:
 *   - News-specific chat placeholder
 *   - News dashboard panel (tabs, feeds list)
 *   - News feed CRUD API
 *   - Reports API
 *
 * Requires: PI_MOCK=true (Playwright config handles this via webServer).
 */

import { test, expect } from "@playwright/test";
import { api, loginAs, sel } from "./helpers";

const RUN_ID = Date.now();
const TEST_USER = `e2e-news-${RUN_ID}`;
const NEWS_SOURCE_ID = "news"; // canonical ID from plugins/news/rss-service.ts

test.describe("News domain", () => {
  let sessionId: number;

  // Seed: user + session for the auto-created news source
  test.beforeAll(async ({ request }) => {
    const a = api(request);
    await a.createUser(TEST_USER, "E2E News Reader");

    // The news source is auto-created by seedDefaultFeeds() on server startup.
    // Create a session so we can navigate directly to the session view.
    const session = await a.createSession(TEST_USER, NEWS_SOURCE_ID, "News Test", {
      mode: "news",
    });
    sessionId = session.id;
  });

  test.afterAll(async ({ request }) => {
    await api(request).deleteUser(TEST_USER);
  });

  // ── News-specific chat UX ─────────────────────────────────────────────────

  test("chat placeholder is news-specific", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // News sources get a different placeholder than books
    const placeholder = await page.locator(sel.chatInput).getAttribute("placeholder");
    expect(placeholder).toMatch(/news/i);
  });

  test("send a news question → mock AI responds", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    await page.fill(sel.chatInput, "What are the top stories today?");
    await page.click(sel.chatSend);

    // User message appears
    await expect(
      page.locator(`${sel.userMessage} ${sel.messageContent}`).last(),
    ).toContainText("top stories today", { timeout: 5_000 });

    // Mock AI response appears
    await expect(
      page.locator(`${sel.assistantMessage} ${sel.messageContent}`).last(),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });
  });

  // ── News dashboard panel ───────────────────────────────────────────────────

  test("right panel opens with news dashboard tabs", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open the right panel via the Dictionary toggle
    await page.locator('button[aria-label="Dictionary"]').click();

    const rightPanel = page.locator(".right-sidebar:not(.hidden)");
    await expect(rightPanel).toBeVisible({ timeout: 5_000 });

    // Switch to the "News Feed" tab (shows NewsDashboardPanel for news sources)
    await rightPanel.locator(".right-sidebar-tab", { hasText: "News Feed" }).click();

    // News dashboard has domain-specific tabs
    await expect(rightPanel.locator("text=Feed Stories")).toBeVisible({ timeout: 3_000 });
    await expect(rightPanel.locator("text=Saved Reports")).toBeVisible({ timeout: 3_000 });
    await expect(rightPanel.locator("text=Feeds Manager")).toBeVisible({ timeout: 3_000 });
  });

  test("feeds manager tab lists default RSS feeds", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open right panel → switch to News Feed tab → Feeds Manager sub-tab
    await page.locator('button[aria-label="Dictionary"]').click();
    const rightPanel = page.locator(".right-sidebar:not(.hidden)");
    await expect(rightPanel).toBeVisible({ timeout: 5_000 });

    // Switch to News Feed tab first
    await rightPanel.locator(".right-sidebar-tab", { hasText: "News Feed" }).click();

    await rightPanel.locator("button", { hasText: "Feeds Manager" }).click();

    // Should show default feed entries from default-feeds.yml
    const feedItems = rightPanel.locator(".feed-item");
    await expect(feedItems.first()).toBeVisible({ timeout: 5_000 });

    const count = await feedItems.count();
    expect(count).toBeGreaterThan(0);

    // Each feed should have a name and URL
    const firstName = await feedItems.first().locator(".feed-name").textContent();
    expect(firstName).toBeTruthy();
  });

  // ── News feed CRUD API ─────────────────────────────────────────────────────

  test("GET /api/news/feeds returns seeded default feeds", async ({ request }) => {
    const res = await request.get("/api/news/feeds");
    expect(res.status()).toBe(200);

    const feeds = await res.json();
    expect(Array.isArray(feeds)).toBe(true);
    expect(feeds.length).toBeGreaterThan(0);

    for (const feed of feeds) {
      expect(feed).toHaveProperty("id");
      expect(feed).toHaveProperty("name");
      expect(feed).toHaveProperty("url");
      expect(feed).toHaveProperty("tags");
    }
  });

  test("POST + DELETE /api/news/feeds — feed CRUD lifecycle", async ({ request }) => {
    const testFeed = {
      id: `test-feed-${RUN_ID}`,
      name: "E2E Test Feed",
      url: "https://example.com/rss",
      tags: ["test"],
    };

    // Add
    const addRes = await request.post("/api/news/feeds", { data: testFeed });
    expect(addRes.status()).toBe(200);
    expect((await addRes.json()).success).toBe(true);

    // Verify present
    const feeds = await (await request.get("/api/news/feeds")).json();
    expect(feeds.some((f: any) => f.id === testFeed.id)).toBe(true);

    // Delete
    const delRes = await request.delete(`/api/news/feeds/${testFeed.id}`);
    expect(delRes.status()).toBe(200);

    // Verify gone
    const feeds2 = await (await request.get("/api/news/feeds")).json();
    expect(feeds2.some((f: any) => f.id === testFeed.id)).toBe(false);
  });

  // ── Reports API ────────────────────────────────────────────────────────────

  test("GET /api/news/reports returns empty lists initially", async ({ request }) => {
    const res = await request.get("/api/news/reports");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("analyses");
    expect(body).toHaveProperty("summaries");
    expect(Array.isArray(body.analyses)).toBe(true);
    expect(Array.isArray(body.summaries)).toBe(true);
  });

  // ── Feed management UI ─────────────────────────────────────────────────────

  test("add a feed via the UI form → appears in list", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open right panel → News Feed tab → Feeds Manager
    await page.locator('button[aria-label="Dictionary"]').click();
    const rightPanel = page.locator(".right-sidebar:not(.hidden)");
    await expect(rightPanel).toBeVisible({ timeout: 5_000 });
    await rightPanel.locator(".right-sidebar-tab", { hasText: "News Feed" }).click();
    await rightPanel.locator("button", { hasText: "Feeds Manager" }).click();

    // Count existing feeds
    const feedItems = rightPanel.locator(".feed-item");
    await expect(feedItems.first()).toBeVisible({ timeout: 5_000 });
    const initialCount = await feedItems.count();

    // Fill in the add-feed form
    const form = rightPanel.locator(".add-feed-form");
    await form.locator('input[placeholder*="Feed Name"]').fill(`UI Test Feed ${RUN_ID}`);
    await form.locator('input[placeholder*="Feed URL"]').fill("https://example.com/test-rss");
    await form.locator('input[placeholder*="Tags"]').fill("e2e, testing");

    // Submit
    await form.locator(".btn-add").click();

    // New feed should appear in the list
    const newFeedItem = rightPanel.locator(".feed-item", { hasText: `UI Test Feed ${RUN_ID}` });
    await expect(newFeedItem).toBeVisible({ timeout: 5_000 });

    // Feed count should have increased
    const newCount = await feedItems.count();
    expect(newCount).toBe(initialCount + 1);

    // New feed should show URL and tags
    await expect(newFeedItem.locator(".feed-url")).toContainText("example.com");
    await expect(newFeedItem.locator(".feed-tag").first()).toContainText("#e2e");
  });

  test("delete a feed via UI → disappears from list", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open right panel → News Feed tab → Feeds Manager
    await page.locator('button[aria-label="Dictionary"]').click();
    const rightPanel = page.locator(".right-sidebar:not(.hidden)");
    await expect(rightPanel).toBeVisible({ timeout: 5_000 });
    await rightPanel.locator(".right-sidebar-tab", { hasText: "News Feed" }).click();
    await rightPanel.locator("button", { hasText: "Feeds Manager" }).click();

    // Find the feed we added in the previous test
    const feedToDelete = rightPanel.locator(".feed-item", { hasText: `UI Test Feed ${RUN_ID}` });
    await expect(feedToDelete).toBeVisible({ timeout: 5_000 });

    const countBefore = await rightPanel.locator(".feed-item").count();

    // Accept the confirm() dialog, then click delete
    page.on("dialog", (dialog) => dialog.accept());
    await feedToDelete.locator(".btn-delete").click();

    // Feed should disappear
    await expect(feedToDelete).not.toBeVisible({ timeout: 5_000 });
    const countAfter = await rightPanel.locator(".feed-item").count();
    expect(countAfter).toBe(countBefore - 1);
  });

  // ── Feed Stories tab ───────────────────────────────────────────────────────

  test("feed stories tab shows empty state with sync button", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open right panel → News Feed tab (default sub-tab is "Feed Stories")
    await page.locator('button[aria-label="Dictionary"]').click();
    const rightPanel = page.locator(".right-sidebar:not(.hidden)");
    await expect(rightPanel).toBeVisible({ timeout: 5_000 });
    await rightPanel.locator(".right-sidebar-tab", { hasText: "News Feed" }).click();

    // "Feed Stories" tab should already be active (default)
    // Since no crawl has been done, should show empty state with sync button
    const syncBtn = rightPanel.locator(".btn-refresh");
    await expect(syncBtn).toBeVisible({ timeout: 5_000 });
    await expect(syncBtn).toContainText("Sync Feeds");
  });
});

