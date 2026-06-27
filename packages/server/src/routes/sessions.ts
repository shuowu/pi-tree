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
import type { SourceSession, SessionContext } from "@pi-tree/shared";

export const sessionCrudRoutes = new Hono();

/**
 * Parse a DB row (with joined source info) into a SourceSession API response.
 */
function rowToSourceSession(row: {
  id: number;
  title: string;
  context: string;
  createdAt: string;
  lastActiveAt: string;
  isActive: number;
  sourceId?: string;
  sourceTitle?: string;
  sourceType?: string;
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
    sourceId: row.sourceId,
    sourceTitle: row.sourceTitle,
    sourceType: row.sourceType as SourceSession["sourceType"],
  };
}

// ---------------------------------------------------------------------------
// GET /sessions/:userId — unified session list
//
// Query params:
//   source       — optional source ID filter (omit for cross-source)
//   source_type  — optional source type filter ('book', 'news', 'paper', 'podcast')
//   limit        — optional, default 50, max 100
//   offset       — optional, default 0
//   search       — optional text search (matches session title or source title)
// ---------------------------------------------------------------------------

sessionCrudRoutes.get("/:userId", async (c) => {
  // Guard: don't match if this looks like a sourceId path segment
  // (handled by the legacy /:userId/:sourceId route below)
  const userId = c.req.param("userId");
  const sourceFilter = c.req.query("source")?.trim();
  const sourceTypeFilter = c.req.query("source_type")?.trim();
  const limitParam = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
  const offsetParam = Number(c.req.query("offset") ?? 0);
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;
  const search = c.req.query("search")?.trim();

  const db = await getDb();

  const conditions = [
    eq(userSessions.userId, userId),
    eq(userSessions.isActive, 1),
    not(eq(sources.type, "router")),
  ];

  if (sourceFilter) {
    conditions.push(eq(userSessions.sourceId, sourceFilter));
  }

  if (sourceTypeFilter) {
    conditions.push(eq(sources.type, sourceTypeFilter));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        like(userSessions.title, pattern),
        like(sources.title, pattern),
      )!,
    );
  }

  const rows = await db
    .select({
      id: userSessions.id,
      title: userSessions.title,
      context: userSessions.context,
      createdAt: userSessions.createdAt,
      lastActiveAt: userSessions.lastActiveAt,
      isActive: userSessions.isActive,
      sourceId: sources.id,
      sourceTitle: sources.title,
      sourceType: sources.type,
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

  const sessions: SourceSession[] = sliced.map(rowToSourceSession);
  return c.json({ sessions, hasMore });
});

// ---------------------------------------------------------------------------
// Legacy: GET /sessions/:userId/:sourceId — redirects to unified endpoint
// Kept for backward compatibility; new code should use ?source= query param.
// ---------------------------------------------------------------------------

sessionCrudRoutes.get("/:userId/:sourceId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");

  const db = await getDb();
  const rows = await db
    .select({
      id: userSessions.id,
      title: userSessions.title,
      context: userSessions.context,
      createdAt: userSessions.createdAt,
      lastActiveAt: userSessions.lastActiveAt,
      isActive: userSessions.isActive,
      sourceId: sources.id,
      sourceTitle: sources.title,
      sourceType: sources.type,
    })
    .from(userSessions)
    .innerJoin(sources, eq(userSessions.sourceId, sources.id))
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

  const db = await getDb();

  // Auto-create user if not present (mirrors TreeManager.ensureUser)
  const existingUser = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!existingUser) {
    await db.insert(users)
      .values({ id: userId, displayName: userId, createdAt: now, updatedAt: now })
      .run();
  }

  const [inserted] = await db
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
    .returning({ id: userSessions.id });

  // Retrieve the newly created row
  const newId = inserted.id;
  const row = await db
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

  const db = await getDb();
  await db.update(userSessions)
    .set(updates)
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        eq(userSessions.sourceId, sourceId),
      ),
    )
    .run();

  // Evict cached session so it recreates with new config (e.g. model change)
  if (body.context !== undefined) {
    closeSession(userId, sourceId, sessionId);
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /sessions/:userId/:sourceId/:sessionId — soft-delete a session
// ---------------------------------------------------------------------------

sessionCrudRoutes.delete("/:userId/:sourceId/:sessionId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = Number(c.req.param("sessionId"));

  const db = await getDb();
  await db.update(userSessions)
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
