/**
 * Router routes — manages the home-router source and session.
 *
 * The "router" is a special system source that powers the home page
 * chat interface, allowing users to discover sources and start sessions.
 *
 * Each visit to the home page gets a FRESH router session — the
 * concierge conversation is ephemeral, not persistent.
 *
 * Mounted at `/api/router`.
 */

import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { getDb, sources, userSessions, users } from "../db/index.js";
import { closeSession } from "../services/session-store.js";

const ROUTER_SOURCE_ID = "home-router";

export const routerRoutes = new Hono();

// ---------------------------------------------------------------------------
// GET /router/session/:userId — always creates a fresh router session
// ---------------------------------------------------------------------------

routerRoutes.get("/session/:userId", (c) => {
  const userId = c.req.param("userId");
  const db = getDb();
  const now = new Date().toISOString();

  // 1. Ensure the router source exists
  db.insert(sources)
    .values({
      id: ROUTER_SOURCE_ID,
      type: "router",
      title: "Home Router",
      author: "System",
      source: "system",
      status: "ready",
      metadata: JSON.stringify({ description: "Session router for the home page" }),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  // 2. Ensure user exists
  const existingUser = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existingUser) {
    db.insert(users)
      .values({ id: userId, displayName: userId, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();
  }

  // 3. Deactivate all previous router sessions for this user
  //    (the concierge chat is ephemeral — no history across page visits)
  const oldSessions = db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.sourceId, ROUTER_SOURCE_ID),
        eq(userSessions.isActive, 1),
      ),
    )
    .all();

  for (const old of oldSessions) {
    // Close any in-memory session state (TreeManager cache, JSONL file handles)
    closeSession(userId, ROUTER_SOURCE_ID, old.id);
    // Soft-delete in DB
    db.update(userSessions)
      .set({ isActive: 0 })
      .where(eq(userSessions.id, old.id))
      .run();
  }

  // 4. Create a fresh router session
  const result = db
    .insert(userSessions)
    .values({
      userId,
      sourceId: ROUTER_SOURCE_ID,
      title: "Home Router",
      sessionFile: "",
      isActive: 1,
      context: JSON.stringify({ mode: "router" }),
      lastActiveAt: now,
      createdAt: now,
    })
    .run();

  return c.json({
    sessionId: Number(result.lastInsertRowid),
    sourceId: ROUTER_SOURCE_ID,
  });
});
