/**
 * E2E: Add Source — tests the Add Source modal (type picker → form flow)
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

  // ── Modal type picker ───────────────────────────────────────────────────

  test("Add Source modal shows type cards for registered source types", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    // Open the Add Source modal
    await page.click("text=Add Source");
    await expect(page.locator(".add-source-modal")).toBeVisible();

    // Verify Book and Paper type cards exist
    const bookCard = page.locator(".add-source-type-card", { hasText: "Book" });
    const paperCard = page.locator(".add-source-type-card", { hasText: "Paper" });
    await expect(bookCard).toBeVisible();
    await expect(paperCard).toBeVisible();
  });

  test("clicking Paper card shows paper form", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    await page.click("text=Add Source");
    await expect(page.locator(".add-source-modal")).toBeVisible();

    // Click the Paper type card
    await page.locator(".add-source-type-card", { hasText: "Paper" }).click();

    // Paper form has title and arXiv fields
    await expect(page.locator("#add-paper-title")).toBeVisible();
    await expect(page.locator("#add-paper-arxivId")).toBeVisible();

    // Book dropzone should NOT be visible
    await expect(page.locator(".add-source-dropzone")).not.toBeVisible();
  });

  // ── Paper creation ──────────────────────────────────────────────────────

  test("Paper card → create paper → appears in library", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Source Tester");
    await page.goto("/library");

    await page.click("text=Add Source");
    await page.locator(".add-source-type-card", { hasText: "Paper" }).click();

    // Fill in paper details
    await page.fill("#add-paper-title", "Attention Is All You Need (E2E)");
    await page.fill("#add-paper-author", "Vaswani et al.");
    await page.fill("#add-paper-arxivId", "1706.03762");

    // Submit
    await page.click(".add-source-submit");

    // Modal should close and the app navigates straight to the created source
    await expect(page.locator(".add-source-modal")).not.toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/source\//, { timeout: 5000 });
    await expect(page.getByRole("heading", { name: "Attention Is All You Need (E2E)" })).toBeVisible({ timeout: 5000 });

    // And the paper appears in the library grid
    await page.goto("/library");
    await expect(page.locator(".source-card", { hasText: "Attention Is All You Need" }).first()).toBeVisible({ timeout: 5000 });
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
