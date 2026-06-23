/**
 * E2E: News domain — tests news-specific UI on top of the session view.
 *
 * Session creation is handled via API (domain-agnostic, already tested).
 * These tests focus on what's unique to the news domain:
 *   - News-specific chat placeholder
 *   - News feed panel (feeds grouped by tag)
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

  // ── News feed panel ─────────────────────────────────────────────────────────

  test("right panel opens with news feed panel", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open the right panel via the Right Panel toggle
    await page.locator('[data-testid="panel-toggle-right-panel"]').click();

    const rightPanel = page.locator(".right-sidebar:not(.hidden)");
    await expect(rightPanel).toBeVisible({ timeout: 5_000 });

    // Switch to the "News Feed" tab (shows NewsDashboardPanel for news sources)
    await rightPanel.locator(".right-sidebar-tab", { hasText: "News Feed" }).click();

    // News dashboard shows feeds grouped by tag
    const feedsPanel = rightPanel.locator(".news-feeds-panel");
    await expect(feedsPanel).toBeVisible({ timeout: 3_000 });

    // Should show feed count status
    await expect(rightPanel.locator(".nfp-status-count")).toBeVisible({ timeout: 3_000 });
  });

  test("news feed panel lists default RSS feeds", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E News Reader");
    await page.goto(`/source/${NEWS_SOURCE_ID}?session=${sessionId}`);

    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open right panel → switch to News Feed tab
    await page.locator('[data-testid="panel-toggle-right-panel"]').click();
    const rightPanel = page.locator(".right-sidebar:not(.hidden)");
    await expect(rightPanel).toBeVisible({ timeout: 5_000 });

    // Switch to News Feed tab
    await rightPanel.locator(".right-sidebar-tab", { hasText: "News Feed" }).click();

    // Should show default feed entries from default-feeds.yml
    const feedItems = rightPanel.locator(".nfp-feed");
    await expect(feedItems.first()).toBeVisible({ timeout: 5_000 });

    const count = await feedItems.count();
    expect(count).toBeGreaterThan(0);

    // Each feed should have a name
    const firstName = await feedItems.first().locator(".nfp-feed-name").textContent();
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
});
