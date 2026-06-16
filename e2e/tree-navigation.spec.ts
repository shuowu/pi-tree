/**
 * E2E: Tree navigation — branching, drill-down, breadcrumb, sidebar.
 *
 * Tests the tree structure that emerges from conversational branching:
 *   Send messages → navigate back → branch → drill into branches →
 *   verify correct messages per branch → breadcrumb navigation
 *
 * Requires: PI_MOCK=true (Playwright config handles this via webServer).
 */

import { test, expect, type Page } from "@playwright/test";
import { api, loginAs, sel } from "./helpers";

const RUN_ID = Date.now();
const TEST_USER = `e2e-tree-${RUN_ID}`;
const TEST_SOURCE = "e2e-tree-book";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send a message and wait for the AI response to finish. */
async function sendAndWait(page: Page, message: string) {
  await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });
  await page.fill(sel.chatInput, message);
  await page.click(sel.chatSend);
  // Wait for loading to finish (input re-enabled)
  await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });
}

/** Open the sidebar tree panel via the breadcrumb toggle. */
async function openSidebar(page: Page) {
  // The "Session Tree" toggle is a panel toggle with aria-label "Session Tree"
  const toggle = page.locator('button[aria-label="Session Tree"]');
  const sidebar = page.locator(".sidebar.open");

  // Only open if not already open
  if (!(await sidebar.isVisible().catch(() => false))) {
    await toggle.click();
    await expect(sidebar).toBeVisible({ timeout: 3_000 });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Tree navigation (mocked AI)", () => {
  let sessionId: number;

  test.beforeAll(async ({ request }) => {
    const a = api(request);
    await a.createUser(TEST_USER, "E2E Tree");
    await a.seedSource(TEST_SOURCE, "E2E Tree Book");
    const session = await a.createSession(TEST_USER, TEST_SOURCE, "Tree Test", {
      mode: "reading",
    });
    sessionId = session.id;
  });

  test.afterAll(async ({ request }) => {
    await api(request).deleteUser(TEST_USER);
  });

  // All tests share a session and run in serial order — each builds on the last.
  test.describe.configure({ mode: "serial" });

  test("conversation grows linearly with multiple messages", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });

    // Send first message
    await sendAndWait(page, "Alpha question one");

    // Should have 1 user + 1 assistant message
    await expect(page.locator(sel.userMessage)).toHaveCount(1);
    await expect(page.locator(sel.assistantMessage)).toHaveCount(1);
    await expect(
      page.locator(`${sel.userMessage} ${sel.messageContent}`).first(),
    ).toContainText("Alpha question one");

    // Send second message
    await sendAndWait(page, "Alpha question two");

    // Should have 2 user + 2 assistant messages
    await expect(page.locator(sel.userMessage)).toHaveCount(2);
    await expect(page.locator(sel.assistantMessage)).toHaveCount(2);
  });

  test("sidebar tree shows nodes after messages", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Open sidebar
    await openSidebar(page);

    // Tree should have at least one entry with a label
    const treeEntries = page.locator(".tree-entry");
    await expect(treeEntries.first()).toBeVisible({ timeout: 5_000 });
    const count = await treeEntries.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("create a branch from root via API with forceBranch", async ({ page, request }) => {
    // Use the API to create a branch deterministically — the UI's auto-branch
    // requires 2+ existing children, but forceBranch always works.
    const a = api(request);
    await a.sendMessage(TEST_USER, TEST_SOURCE, sessionId, "Beta question from root", {
      forceBranch: true,
    });

    // Verify the branch exists by navigating to root in the UI
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Navigate to root via sidebar
    await openSidebar(page);
    const rootEntry = page.locator(".tree-entry").first();
    await rootEntry.click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Root should now have branches (Alpha chain + Beta branch)
  });

  test("inline branches appear at branch point", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Navigate to root via sidebar to see branches
    await openSidebar(page);
    const rootEntry = page.locator(".tree-entry").first();
    await rootEntry.click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Should see inline branches at the branch point
    const branchCards = page.locator(".pit-inline-branch");
    await expect(branchCards).toHaveCount(2, { timeout: 15_000 });
  });

  test("drill into first branch → see Alpha messages", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Navigate to root to see branches
    await openSidebar(page);
    await page.locator(".tree-entry").first().click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Wait for branch cards to appear
    const branches = page.locator(".pit-inline-branch");
    await expect(branches).toHaveCount(2, { timeout: 10_000 });

    // Click "Open →" on the first branch (Alpha chain)
    const openButtons = page.locator(".pit-inline-branch-open");
    await expect(openButtons.first()).toBeVisible({ timeout: 10_000 });
    await openButtons.first().click();

    // Wait for navigation
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // The Alpha branch should show Alpha messages in the conversation
    const userMessages = page.locator(`${sel.userMessage} ${sel.messageContent}`);
    await expect(userMessages.first()).toBeVisible({ timeout: 5_000 });
    const texts = await userMessages.allTextContents();
    expect(texts.some((t) => t.includes("Alpha"))).toBe(true);
  });

  test("drill into second branch → see Beta message", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Navigate to root to see branches
    await openSidebar(page);
    await page.locator(".tree-entry").first().click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Wait for branch cards
    const branches = page.locator(".pit-inline-branch");
    await expect(branches).toHaveCount(2, { timeout: 10_000 });

    // Click "Open →" on the second branch (Beta)
    const openButtons = page.locator(".pit-inline-branch-open");
    await expect(openButtons.nth(1)).toBeVisible({ timeout: 10_000 });
    await openButtons.nth(1).click();

    // Wait for navigation
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // The Beta branch shows:
    // 1. Fork context: grandparent user ("Alpha question one") + parent AI response
    //    (collectScopeMessages prepends these so users see what led to the fork)
    // 2. Branch-specific: user "Beta question from root" + AI response
    // Assert the LAST user message is the branch-specific Beta content
    const userMessages = page.locator(`${sel.userMessage} ${sel.messageContent}`);
    await expect(userMessages.last()).toBeVisible({ timeout: 5_000 });
    await expect(userMessages.last()).toContainText("Beta");
  });

  test("breadcrumb shows path when scoped into a branch", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Navigate to root → open first branch (to get scoped view)
    await openSidebar(page);
    await page.locator(".tree-entry").first().click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    const openButtons = page.locator(".pit-inline-branch-open");
    await expect(openButtons.first()).toBeVisible({ timeout: 10_000 });
    await openButtons.first().click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // When scoped, breadcrumb should show the root as a clickable link
    const breadcrumbRoot = page.locator(".pit-breadcrumb-root");
    await expect(breadcrumbRoot).toBeVisible({ timeout: 5_000 });

    // Breadcrumb should have at least one segment (the current node)
    const breadcrumbSegments = page.locator(".pit-breadcrumb-segment");
    const segCount = await breadcrumbSegments.count();
    expect(segCount).toBeGreaterThanOrEqual(1);
  });

  test("breadcrumb root click navigates back to root view", async ({ page }) => {
    await loginAs(page, TEST_USER, "E2E Tree");
    await page.goto(`/source/${TEST_SOURCE}?session=${sessionId}`);
    await expect(page.locator(sel.chatView)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 15_000 });

    // Navigate into a branch first
    await openSidebar(page);
    await page.locator(".tree-entry").first().click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    const openButtons = page.locator(".pit-inline-branch-open");
    await expect(openButtons.first()).toBeVisible({ timeout: 10_000 });
    await openButtons.first().click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // Verify we're scoped (breadcrumb root link visible)
    const breadcrumbRoot = page.locator(".pit-breadcrumb-root");
    await expect(breadcrumbRoot).toBeVisible({ timeout: 5_000 });

    // Click the root breadcrumb to go back
    await breadcrumbRoot.click();
    await expect(page.locator(sel.chatInput)).toBeEnabled({ timeout: 10_000 });

    // After navigating to root, inline branches should be visible again
    await expect(page.locator(".pit-inline-branch").first()).toBeVisible({ timeout: 10_000 });

    // The breadcrumb root link should no longer be visible (we're at root now)
    await expect(breadcrumbRoot).not.toBeVisible({ timeout: 3_000 });
  });
});
