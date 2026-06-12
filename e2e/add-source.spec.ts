/**
 * E2E: Add Source — tests the Add Source modal (Book / Paper / Custom tabs)
 * and verifies created sources appear in the library.
 *
 * No LLM calls — only tests UI forms, API calls, and library listing.
 *
 * Requires: PI_MOCK=true (Playwright config handles this via webServer).
 */

import { test, expect } from "@playwright/test";
import { api, loginAs } from "./helpers";

const RUN_ID = Date.now();
const TEST_USER = `e2e-source-${RUN_ID}`;

test.describe("Add Source", () => {
  test.beforeAll(async ({ request }) => {
    await api(request).createUser(TEST_USER, "E2E Source Tester");
  });

  test.afterAll(async ({ request }) => {
    await api(request).deleteUser(TEST_USER);
  });

  // ── Modal tabs ──────────────────────────────────────────────────────────

  test("Add Source modal shows Book, Paper, and Custom tabs", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    // Open the Add Source modal
    await page.click("text=Add Source");
    await expect(page.locator(".add-book-modal")).toBeVisible();

    // Verify all three tabs exist
    const tabs = page.locator(".add-book-tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText("Book");
    await expect(tabs.nth(1)).toContainText("Paper");
    await expect(tabs.nth(2)).toContainText("Custom");

    // Book tab is active by default
    await expect(tabs.nth(0)).toHaveClass(/active/);

    // Book tab shows the file dropzone
    await expect(page.locator(".add-book-dropzone")).toBeVisible();
  });

  test("switching to Paper tab shows paper form", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    await page.click("text=Add Source");
    await expect(page.locator(".add-book-modal")).toBeVisible();

    // Switch to Paper tab
    await page.click(".add-book-tab:has-text('Paper')");

    // Paper form has title and arXiv fields
    await expect(page.locator("#add-paper-title")).toBeVisible();
    await expect(page.locator("#add-paper-arxiv")).toBeVisible();

    // Dropzone should NOT be visible
    await expect(page.locator(".add-book-dropzone")).not.toBeVisible();
  });

  test("switching to Custom tab shows type input and path hint", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    await page.click("text=Add Source");
    await page.click(".add-book-tab:has-text('Custom')");

    // Custom form has title and type fields
    await expect(page.locator("#add-custom-title")).toBeVisible();
    await expect(page.locator("#add-custom-type")).toBeVisible();

    // Hint about content path is visible
    await expect(page.locator(".add-book-hint")).toBeVisible();
    await expect(page.locator(".add-book-hint")).toContainText("DATA_PATH");
  });

  // ── Paper creation ──────────────────────────────────────────────────────

  test("Paper tab → create paper → appears in library", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    await page.click("text=Add Source");
    await page.click(".add-book-tab:has-text('Paper')");

    // Fill in paper details
    await page.fill("#add-paper-title", "Attention Is All You Need (E2E)");
    await page.fill("#add-paper-author", "Vaswani et al.");
    await page.fill("#add-paper-arxiv", "1706.03762");

    // Submit
    await page.click(".add-book-submit");

    // Modal should close
    await expect(page.locator(".add-book-modal")).not.toBeVisible({ timeout: 5000 });

    // Paper should appear in the library grid after reload
    await expect(page.locator(".book-card", { hasText: "Attention Is All You Need" }).first()).toBeVisible({ timeout: 5000 });
  });

  // ── Custom source creation ──────────────────────────────────────────────

  test("Custom tab → create custom source → appears in library", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    await page.click("text=Add Source");
    await page.click(".add-book-tab:has-text('Custom')");

    // Fill in custom source details
    await page.fill("#add-custom-title", "My Tutorial (E2E)");
    await page.fill("#add-custom-type", "tutorial");

    // Submit
    await page.click(".add-book-submit");

    // Modal should close
    await expect(page.locator(".add-book-modal")).not.toBeVisible({ timeout: 5000 });

    // Source should appear in the library
    await expect(page.locator(".book-card", { hasText: "My Tutorial" }).first()).toBeVisible({ timeout: 5000 });
  });

  // ── API-level: POST /library/sources/create ─────────────────────────────

  test("POST /api/library/sources/create → 201 + source in listing", async ({ request }) => {
    const res = await request.post("/api/library/sources/create", {
      data: {
        title: "API Created Paper (E2E)",
        type: "paper",
        author: "Test",
        metadata: { arxivId: "2301.07041" },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("paper");
    expect(body.status).toBe("ready");
    expect(body.metadata).toEqual({ arxivId: "2301.07041" });

    // Verify it shows up in the listing
    const listRes = await request.get("/api/library/sources?type=paper");
    const listBody = await listRes.json();
    const found = listBody.sources.find((s: any) => s.id === body.id);
    expect(found).toBeDefined();

    // Clean up
    await request.delete(`/api/library/sources/${body.id}`);
  });
});
