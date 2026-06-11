/**
 * Record a conversation tree demo from an existing session.
 *
 * Usage:
 *   BASE_URL=http://localhost:3847 npx playwright test --config=scripts/record-demo.config.ts
 *
 * Records:
 *   1. Open session directly — rich AI conversation
 *   2. Scroll through conversation content
 *   3. Navigate branches in the tree
 *   4. Send a follow-up message to show streaming
 */

import { test } from "@playwright/test";
import { loginAs, sel } from "../e2e/helpers";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const OUTPUT_DIR = path.join(__dirname, "..", "website", "public", "images");

test.use({
  viewport: { width: 1280, height: 720 },
  video: {
    mode: "on",
    size: { width: 1280, height: 720 },
  },
});

// Smooth scroll helper
async function smoothScroll(page: any, selector: string | null, distance: number, speed = 5) {
  await page.evaluate(
    ({ sel, dist, spd }: { sel: string | null; dist: number; spd: number }) => {
      return new Promise<void>((resolve) => {
        const el = sel ? document.querySelector(sel) : window;
        if (!el) { resolve(); return; }
        let scrolled = 0;
        const interval = setInterval(() => {
          if (sel) {
            (el as Element).scrollBy(0, dist > 0 ? spd : -spd);
          } else {
            window.scrollBy(0, dist > 0 ? spd : -spd);
          }
          scrolled += spd;
          if (scrolled >= Math.abs(dist)) {
            clearInterval(interval);
            resolve();
          }
        }, 16);
      });
    },
    { sel: selector, dist: distance, spd: speed },
  );
}

// Move cursor smoothly to an element (makes cursor visible in recording)
async function moveTo(page: any, locator: any) {
  const box = await locator.boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    // Move in steps for a smooth visual
    await page.mouse.move(targetX, targetY, { steps: 15 });
    await page.waitForTimeout(200);
  }
}

test("record conversation tree demo", async ({ page }) => {
  // Login as shuo
  await loginAs(page, "shuo", "shuo");

  // Inject a visible cursor overlay — Playwright video doesn't capture the system cursor
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const cursor = document.createElement("div");
      cursor.id = "pw-cursor";
      cursor.style.cssText = `
        width: 20px; height: 20px;
        border-radius: 50%;
        background: rgba(180, 120, 60, 0.6);
        border: 2px solid rgba(140, 90, 40, 0.8);
        box-shadow: 0 0 8px rgba(180, 120, 60, 0.4);
        position: fixed;
        top: -50px; left: -50px;
        z-index: 999999;
        pointer-events: none;
        transition: transform 0.08s ease-out, opacity 0.15s;
        transform: translate(-50%, -50%);
      `;
      document.body.appendChild(cursor);

      document.addEventListener("mousemove", (e) => {
        cursor.style.left = e.clientX + "px";
        cursor.style.top = e.clientY + "px";
      });
      document.addEventListener("mousedown", () => {
        cursor.style.transform = "translate(-50%, -50%) scale(0.7)";
      });
      document.addEventListener("mouseup", () => {
        cursor.style.transform = "translate(-50%, -50%) scale(1)";
      });
    });
  });

  // ── Scene 1: Open the news session directly ──────────────────────
  await page.goto("/source/news?session=4");
  await page.waitForLoadState("networkidle");

  // Wait for chat view to render with messages
  try {
    await page.waitForSelector(sel.assistantMessage, { timeout: 15000 });
  } catch {
    // Fallback — wait for chat view at least
    await page.waitForSelector(sel.chatView, { timeout: 10000 });
  }
  await page.waitForTimeout(3000);

  // ── Scene 2: Slowly scroll through the conversation ──────────────
  // Move cursor into the chat area first
  const chatArea = page.locator(sel.chatMessages);
  await moveTo(page, chatArea);

  // The AI response should have structured news sections — show them
  await smoothScroll(page, sel.chatMessages, 400, 4);
  await page.waitForTimeout(2000);

  await smoothScroll(page, sel.chatMessages, 400, 4);
  await page.waitForTimeout(2000);

  // Scroll back up to see the full picture
  await smoothScroll(page, sel.chatMessages, -600, 6);
  await page.waitForTimeout(1500);

  // ── Scene 3: Interact with branches ──────────────────────────────
  // Look for branch cards (inline branches)
  const branchSection = page.locator(sel.inlineBranches).first();
  if (await branchSection.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Scroll to branches
    await branchSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);

    // Hover the first branch card
    const branchCards = page.locator(".pit-branch-card");
    const count = await branchCards.count();

    if (count > 0) {
      // Move cursor to first branch and hover
      await moveTo(page, branchCards.first());
      await branchCards.first().hover();
      await page.waitForTimeout(1000);

      // If there's a second branch, move to it and hover
      if (count > 1) {
        await moveTo(page, branchCards.nth(1));
        await branchCards.nth(1).hover();
        await page.waitForTimeout(1000);
      }

      // Move back to first branch and click
      await moveTo(page, branchCards.first());
      await page.waitForTimeout(300);
      await branchCards.first().click();
      await page.waitForTimeout(3000);

      // Scroll through the branch content
      await moveTo(page, page.locator(sel.chatMessages));
      await smoothScroll(page, sel.chatMessages, 300, 4);
      await page.waitForTimeout(2000);
    }
  }

  // ── Scene 4: Show the sidebar topic tree ─────────────────────────
  // Look for sidebar toggle or the sidebar itself
  const sidebarToggle = page.locator("[aria-label*='ree'], [aria-label*='idebar'], button:has(.lucide-git-branch-plus), button:has(.lucide-panel-left)").first();
  if (await sidebarToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    await moveTo(page, sidebarToggle);
    await sidebarToggle.click();
    await page.waitForTimeout(2000);
  }

  // ── Scene 5: Navigate back via breadcrumb ────────────────────────
  const breadcrumbItems = page.locator(".pit-breadcrumb-bar a, .pit-breadcrumb-item");
  if (await breadcrumbItems.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    // Move cursor to the root breadcrumb and click
    await moveTo(page, breadcrumbItems.first());
    await page.waitForTimeout(300);
    await breadcrumbItems.first().click();
    await page.waitForTimeout(2500);
  }

  // ── Scene 6: Send a follow-up message to show streaming ──────────
  const chatInput = page.locator(sel.chatInput);
  if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Move cursor to chat input
    await moveTo(page, chatInput);
    await chatInput.click();
    await page.waitForTimeout(500);

    // Type slowly for the demo effect
    await page.keyboard.type("Deep dive into the OpenAI vs Anthropic price war", { delay: 40 });
    await page.waitForTimeout(800);

    // Move cursor to send button and click
    const sendBtn = page.locator(sel.chatSend);
    await moveTo(page, sendBtn);
    await page.waitForTimeout(200);
    await sendBtn.click();

    // Wait for the streaming response to appear and show for a few seconds
    try {
      await page.waitForSelector(`${sel.chatStreaming}, ${sel.assistantMessage}:last-child`, {
        timeout: 10000,
      });
      // Let streaming run for a few seconds to show the effect
      await page.waitForTimeout(6000);
    } catch {
      await page.waitForTimeout(4000);
    }
  }

  // Final pause
  await page.waitForTimeout(1500);

  // ── Save video ───────────────────────────────────────────────────
  await page.close();

  const video = page.video();
  if (video) {
    const videoPath = await video.path();
    if (videoPath) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });

      const outputWebm = path.join(OUTPUT_DIR, "demo.webm");
      const outputMp4 = path.join(OUTPUT_DIR, "demo.mp4");

      // Copy the webm
      fs.copyFileSync(videoPath, outputWebm);
      console.log(`✅ WebM saved: ${outputWebm}`);

      // Convert to MP4 for Safari fallback (much smaller than GIF)
      try {
        const cmd = `ffmpeg -y -i "${outputWebm}" -vf "scale=960:-1" -c:v libx264 -pix_fmt yuv420p -preset slow -crf 28 -movflags +faststart "${outputMp4}"`;
        execSync(cmd, { stdio: "inherit" });
        console.log(`✅ MP4 saved: ${outputMp4}`);
      } catch {
        console.log(`⚠️  MP4 conversion failed (ffmpeg needed). Video is at: ${outputWebm}`);
      }
    }
  }
});
