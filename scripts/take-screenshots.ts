/**
 * Take clean screenshots for the documentation site.
 * No browser chrome — just viewport captures.
 *
 * Usage:
 *   BASE_URL=http://localhost:3847 npx playwright test --config=scripts/record-demo.config.ts scripts/take-screenshots.ts
 */

import { test, expect } from "@playwright/test";
import { loginAs, sel } from "../e2e/helpers";
import path from "path";
import fs from "fs";

const OUTPUT_DIR = path.join(__dirname, "..", "website", "public", "images");

test.use({
  viewport: { width: 1280, height: 800 },
  video: "off",
});

test("take home page screenshot", async ({ page }) => {
  await loginAs(page, "shuo", "shuo");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "home.png"),
    fullPage: false,
  });
  console.log("✅ home.png saved");
});

test("take library screenshot", async ({ page }) => {
  await loginAs(page, "shuo", "shuo");

  // Navigate to library via quick action
  await page.goto("/library");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "library.png"),
    fullPage: false,
  });
  console.log("✅ library.png saved");
});

test("take reading session screenshot", async ({ page }) => {
  await loginAs(page, "shuo", "shuo");

  // Open the Principles book reading session
  await page.goto("/source/Principles_Dalio_2017");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  // Click Resume if we're on the sessions page
  const resumeBtn = page.locator("text=Resume").first();
  if (await resumeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await resumeBtn.click();
    await page.waitForTimeout(2000);
  }

  // Wait for chat content to load
  try {
    await page.waitForSelector(sel.assistantMessage, { timeout: 15000 });
  } catch {
    await page.waitForSelector(sel.chatView, { timeout: 10000 });
  }
  await page.waitForTimeout(2000);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "reading-session.png"),
    fullPage: false,
  });
  console.log("✅ reading-session.png saved");
});

test("take news session screenshot", async ({ page }) => {
  await loginAs(page, "shuo", "shuo");

  // Open the news session with tree branches
  await page.goto("/source/news?session=4");
  await page.waitForLoadState("networkidle");

  // Wait for chat content
  try {
    await page.waitForSelector(sel.assistantMessage, { timeout: 15000 });
  } catch {
    await page.waitForSelector(sel.chatView, { timeout: 10000 });
  }
  await page.waitForTimeout(2000);

  // Scroll down to show branches
  const chatMessages = page.locator(sel.chatMessages);
  await chatMessages.evaluate((el: Element) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(1000);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "news-session.png"),
    fullPage: false,
  });
  console.log("✅ news-session.png saved");
});
