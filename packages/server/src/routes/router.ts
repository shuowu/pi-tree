/**
 * Router routes — manages ephemeral home-router sessions.
 *
 * The "router" is a system session that powers the home page chat.
 * Sessions are purely in-memory — no DB rows, no source entry.
 * Each visit creates a fresh session; the previous one is discarded.
 *
 * Mounted at `/api/router`.
 */

import { Hono } from "hono";
import { TreeManager } from "../services/tree-manager.js";
import {
  registerSession,
  closeSessionByKey,
} from "../services/session-store.js";

export const routerRoutes = new Hono();

// Track the active router session key per user so we can close the old one
const activeRouterKeys = new Map<string, string>();

// One-time legacy cleanup flag
let legacyCleaned = false;

/**
 * Remove legacy home-router source and sessions from DB.
 * Safe to call multiple times — no-ops after the first successful run.
 */
async function cleanupLegacyRouterRows(): Promise<void> {
  if (legacyCleaned) return;
  try {
    const { getDb, sources, userSessions } = await import("../db/index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    db.delete(userSessions).where(eq(userSessions.sourceId, "home-router")).run();
    db.delete(sources).where(eq(sources.id, "home-router")).run();
    legacyCleaned = true;
    console.log("[router] Cleaned up legacy home-router DB rows");
  } catch {
    // DB not ready yet or already clean — will retry on next request
  }
}

// ---------------------------------------------------------------------------
// GET /router/session/:userId — creates a fresh ephemeral router session
// ---------------------------------------------------------------------------

routerRoutes.get("/session/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    // One-time: remove legacy DB rows from before the ephemeral refactor
    await cleanupLegacyRouterRows();

    // Close any previous router session for this user
    const oldKey = activeRouterKeys.get(userId);
    if (oldKey) {
      closeSessionByKey(oldKey);
    }

    // Create an ephemeral session (no DB, no source row)
    const manager = await TreeManager.createEphemeral(userId, "router", "router");

    // Register in session-store under a synthetic key
    const sessionKey = `router:${userId}:${Date.now()}`;
    registerSession(sessionKey, manager);
    activeRouterKeys.set(userId, sessionKey);

    return c.json({ sessionKey });
  } catch (err) {
    console.error("Router session error:", err);
    return c.json({ error: String(err) }, 500);
  }
});
