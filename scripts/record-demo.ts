/**
 * Record a conversation tree demo from an existing session.
 *
 * Usage:
 *   BASE_URL=http://localhost:3847 npx playwright test --config=scripts/record-demo.config.ts scripts/record-demo.ts
 *
 * The recording is designed to clearly show the tree structure and
 * branch navigation — the core differentiator of pi-tree.
 *
 * Flow:
 *   1. Open session → see tree sidebar with branches + AI conversation
 *   2. Scroll to "2 BRANCHES" section with branch cards
 *   3. Hover branch cards briefly
 *   4. Click "Open →" on a branch → view CHANGES to branch content
 *   5. Linger on branch content — shows different conversation, breadcrumb path
 *   6. Scroll through branch conversation
 *   7. Navigate back to parent via breadcrumb root click
 *   8. Parent view returns with branch cards visible again
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

// Move cursor smoothly to an element
async function moveTo(page: any, locator: any) {
  const box = await locator.boundingBox();
  if (box) {
    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    await page.mouse.move(targetX, targetY, { steps: 15 });
    await page.waitForTimeout(200);
  }
}

test("record conversation tree demo", async ({ page }) => {
  await loginAs(page, "shuo", "shuo");

  // Inject visible cursor overlay (Playwright doesn't capture system cursor)
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

  // ────────────────────────────────────────────────────────────────────
  // Scene 1: Open the news session — sidebar with tree visible
  // ────────────────────────────────────────────────────────────────────
  await page.goto("/source/news?session=4");
  await page.waitForLoadState("networkidle");

  try {
    await page.waitForSelector(sel.assistantMessage, { timeout: 15000 });
  } catch {
    await page.waitForSelector(sel.chatView, { timeout: 10000 });
  }
  // Let the viewer take in the full layout: tree sidebar + conversation
  await page.waitForTimeout(3000);

  // ────────────────────────────────────────────────────────────────────
  // Scene 2: Scroll down to show the branch cards
  // ────────────────────────────────────────────────────────────────────
  const chatArea = page.locator(sel.chatMessages);
  await moveTo(page, chatArea);

  // Scroll to the bottom of the conversation where branch cards live
  const branchSection = page.locator(sel.inlineBranches).first();
  await branchSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);

  // ────────────────────────────────────────────────────────────────────
  // Scene 3: Hover both branch cards
  // ────────────────────────────────────────────────────────────────────
  const branchCards = page.locator(".pit-inline-branch");
  const count = await branchCards.count();

  if (count > 0) {
    // Hover first branch
    await moveTo(page, branchCards.first());
    await branchCards.first().hover();
    await page.waitForTimeout(1000);

    // Hover second branch (the one with more content)
    if (count > 1) {
      await moveTo(page, branchCards.nth(1));
      await branchCards.nth(1).hover();
      await page.waitForTimeout(1000);
    }

    // ──────────────────────────────────────────────────────────────────
    // Scene 4: Click "Open →" on the second branch (DiffusionGemma, 3 msgs)
    // This is the key moment — the view transitions to branch content
    // ──────────────────────────────────────────────────────────────────
    const targetBranch = count > 1 ? branchCards.nth(1) : branchCards.first();
    const openBtn = targetBranch.locator(".pit-inline-branch-open");

    if (await openBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await moveTo(page, openBtn);
      await page.waitForTimeout(500);
      await openBtn.click();
    } else {
      // Fallback: click the branch card itself
      await targetBranch.click();
    }

    // ──────────────────────────────────────────────────────────────────
    // Scene 5: Branch content loaded — hold so the viewer sees the change
    // The conversation now shows DIFFERENT content (the branch topic).
    // The breadcrumb updates to show the navigation path.
    // The sidebar tree highlights the current branch node.
    // ──────────────────────────────────────────────────────────────────
    await page.waitForTimeout(3000);

    // Scroll through the branch conversation slowly to show it's
    // a different conversation from the parent
    await moveTo(page, page.locator(sel.chatMessages));
    await smoothScroll(page, sel.chatMessages, 300, 3);
    await page.waitForTimeout(2000);

    // Scroll a bit more to show the depth of the branch conversation
    await smoothScroll(page, sel.chatMessages, 250, 3);
    await page.waitForTimeout(2000);

    // ──────────────────────────────────────────────────────────────────
    // Scene 6: Navigate back to parent via breadcrumb
    // Click the root breadcrumb to return to the parent conversation
    // ──────────────────────────────────────────────────────────────────
    const rootCrumb = page.locator(".pit-breadcrumb-root").first();
    if (await rootCrumb.isVisible({ timeout: 2000 }).catch(() => false)) {
      await moveTo(page, rootCrumb);
      await page.waitForTimeout(500);
      await rootCrumb.click();
      // Wait for parent view to reload — branch cards should appear again
      await page.waitForTimeout(3000);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Scene 7: Back at parent — scroll to show branch cards are still there
  // The branch cards should be visible, confirming we've navigated back
  // ────────────────────────────────────────────────────────────────────
  const branchSectionAgain = page.locator(sel.inlineBranches).first();
  if (await branchSectionAgain.isVisible({ timeout: 3000 }).catch(() => false)) {
    await branchSectionAgain.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
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

      fs.copyFileSync(videoPath, outputWebm);
      console.log(`✅ WebM saved: ${outputWebm}`);

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
