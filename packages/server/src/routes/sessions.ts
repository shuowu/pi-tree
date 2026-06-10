/**
 * Session CRUD routes — manage multiple sessions per user+source.
 *
 * Mounted at `/api/sessions/` (plural) — separate from the existing
 * `/api/session/` (singular) which handles real-time session interaction.
 *
 * These endpoints let the client list, create, update, and soft-delete
 * sessions before starting a reading interaction.
 */

import { Hono } from "hono";
import { eq, and, not, desc, like, or, sql } from "drizzle-orm";
import { getDb, userSessions, users, sources } from "../db/index.js";
import { closeSession } from "../services/session-store.js";
import type { SourceSession, SessionContext, RecentSession } from "@pi-tree/shared";

export const sessionCrudRoutes = new Hono();

/**
 * Parse a DB row into a SourceSession API response object.
 */
function rowToSourceSession(row: {
  id: number;
  title: string;
  context: string;
  createdAt: string;
  lastActiveAt: string;
  isActive: number;
}): SourceSession {
  let context: SessionContext;
  try {
    context = JSON.parse(row.context) as SessionContext;
  } catch {
    context = { mode: "reading" };
  }
  return {
    id: row.id,
    title: row.title,
    context,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    isActive: row.isActive === 1,
  };
}

// ---------------------------------------------------------------------------
// GET /sessions/:userId/recent — cross-source recent sessions (home page)
// ---------------------------------------------------------------------------

sessionCrudRoutes.get("/:userId/recent", (c) => {
  const userId = c.req.param("userId");
  const limitParam = Math.min(Number(c.req.query("limit") ?? 8), 50);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 8;
  const offsetParam = Number(c.req.query("offset") ?? 0);
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
  const search = c.req.query("search")?.trim();

  const db = getDb();

  const conditions = [
    eq(userSessions.userId, userId),
    eq(userSessions.isActive, 1),
    not(eq(sources.type, "router")),
  ];

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        like(userSessions.title, pattern),
        like(sources.title, pattern),
      )!,
    );
  }

  const rows = db
    .select({
      id: userSessions.id,
      title: userSessions.title,
      context: userSessions.context,
      lastActiveAt: userSessions.lastActiveAt,
      sourceId: sources.id,
      sourceTitle: sources.title,
      sourceType: sources.type,
      coverUrl: sources.coverUrl,
    })
    .from(userSessions)
    .innerJoin(sources, eq(userSessions.sourceId, sources.id))
    .where(and(...conditions))
    .orderBy(desc(userSessions.lastActiveAt))
    .limit(limit + 1)
    .offset(offset)
    .all();

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  const sessions: RecentSession[] = sliced.map((row) => {
    let mode = "reading";
    try {
      const ctx = JSON.parse(row.context) as SessionContext;
      mode = ctx.mode ?? "reading";
    } catch {
      // default to reading
    }
    return {
      sessionId: row.id,
      sessionTitle: row.title,
      sourceId: row.sourceId,
      sourceTitle: row.sourceTitle,
      sourceType: row.sourceType as RecentSession["sourceType"],
      mode,
      lastActiveAt: row.lastActiveAt,
      hasCover: false,
    };
  });

  return c.json({ sessions, hasMore });
});

// ---------------------------------------------------------------------------
// GET /sessions/:userId/:sourceId — list all sessions for a user+source
// ---------------------------------------------------------------------------

sessionCrudRoutes.get("/:userId/:sourceId", (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");

  const db = getDb();
  const rows = db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.sourceId, sourceId),
        eq(userSessions.isActive, 1),
      ),
    )
    .orderBy(desc(userSessions.lastActiveAt))
    .all();

  const sessions: SourceSession[] = rows.map(rowToSourceSession);
  return c.json({ sessions });
});

// ---------------------------------------------------------------------------
// POST /sessions/:userId/:sourceId — create a new session
// ---------------------------------------------------------------------------

sessionCrudRoutes.post("/:userId/:sourceId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const body = await c.req.json<{
    title: string;
    context?: SessionContext;
  }>();

  const context: SessionContext = body.context ?? { mode: "reading" };
  const now = new Date().toISOString();

  const db = getDb();

  // Auto-create user if not present (mirrors TreeManager.ensureUser)
  const existingUser = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existingUser) {
    db.insert(users)
      .values({ id: userId, displayName: userId, createdAt: now, updatedAt: now })
      .run();
  }

  const result = db
    .insert(userSessions)
    .values({
      userId,
      sourceId,
      title: body.title,
      context: JSON.stringify(context),
      sessionFile: `pending-${Date.now()}`, // Placeholder — overwritten on first loadOrCreate
      isActive: 1,
      createdAt: now,
      lastActiveAt: now,
    })
    .run();

  // Retrieve the newly created row
  const newId = Number(result.lastInsertRowid);
  const row = db
    .select()
    .from(userSessions)
    .where(eq(userSessions.id, newId))
    .get();

  if (!row) {
    return c.json({ error: "Failed to create session" }, 500);
  }

  return c.json(rowToSourceSession(row), 201);
});

// ---------------------------------------------------------------------------
// PUT /sessions/:userId/:sourceId/:sessionId — update session metadata
// ---------------------------------------------------------------------------

sessionCrudRoutes.put("/:userId/:sourceId/:sessionId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = Number(c.req.param("sessionId"));
  const body = await c.req.json<{
    title?: string;
    context?: SessionContext;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) {
    updates.title = body.title;
  }
  if (body.context !== undefined) {
    updates.context = JSON.stringify(body.context);
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ ok: true });
  }

  const db = getDb();
  db.update(userSessions)
    .set(updates)
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        eq(userSessions.sourceId, sourceId),
      ),
    )
    .run();

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /sessions/:userId/:sourceId/:sessionId — soft-delete a session
// ---------------------------------------------------------------------------

sessionCrudRoutes.delete("/:userId/:sourceId/:sessionId", (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = Number(c.req.param("sessionId"));

  const db = getDb();
  db.update(userSessions)
    .set({ isActive: 0 })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        eq(userSessions.sourceId, sourceId),
      ),
    )
    .run();

  // Evict from memory
  closeSession(userId, sourceId, sessionId);

  return c.json({ ok: true });
});
