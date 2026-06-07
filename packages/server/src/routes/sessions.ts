/**
 * Session CRUD routes — manage multiple sessions per user+book.
 *
 * Mounted at `/api/sessions/` (plural) — separate from the existing
 * `/api/session/` (singular) which handles real-time session interaction.
 *
 * These endpoints let the client list, create, update, and soft-delete
 * sessions before starting a reading interaction.
 */

import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { getDb, userBookSessions } from "../db/index.js";
import { closeSession } from "../services/session-store.js";
import type { BookSession, SessionContext } from "@pi-books/shared";

export const sessionCrudRoutes = new Hono();

/**
 * Parse a DB row into a BookSession API response object.
 */
function rowToBookSession(row: {
  id: number;
  title: string;
  context: string;
  createdAt: string;
  lastActiveAt: string;
  isActive: number;
}): BookSession {
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
// GET /sessions/:userId/:bookId — list all sessions for a user+book
// ---------------------------------------------------------------------------

sessionCrudRoutes.get("/:userId/:bookId", (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");

  const db = getDb();
  const rows = db
    .select()
    .from(userBookSessions)
    .where(
      and(
        eq(userBookSessions.userId, userId),
        eq(userBookSessions.bookId, bookId),
        eq(userBookSessions.isActive, 1),
      ),
    )
    .orderBy(desc(userBookSessions.lastActiveAt))
    .all();

  const sessions: BookSession[] = rows.map(rowToBookSession);
  return c.json({ sessions });
});

// ---------------------------------------------------------------------------
// POST /sessions/:userId/:bookId — create a new session
// ---------------------------------------------------------------------------

sessionCrudRoutes.post("/:userId/:bookId", async (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");
  const body = await c.req.json<{
    title: string;
    context?: SessionContext;
  }>();

  const context: SessionContext = body.context ?? { mode: "reading" };
  const now = new Date().toISOString();

  const db = getDb();
  const result = db
    .insert(userBookSessions)
    .values({
      userId,
      bookId,
      title: body.title,
      context: JSON.stringify(context),
      sessionFile: "", // Will be set on first loadOrCreate
      isActive: 1,
      createdAt: now,
      lastActiveAt: now,
    })
    .run();

  // Retrieve the newly created row
  const newId = Number(result.lastInsertRowid);
  const row = db
    .select()
    .from(userBookSessions)
    .where(eq(userBookSessions.id, newId))
    .get();

  if (!row) {
    return c.json({ error: "Failed to create session" }, 500);
  }

  return c.json(rowToBookSession(row), 201);
});

// ---------------------------------------------------------------------------
// PUT /sessions/:userId/:bookId/:sessionId — update session metadata
// ---------------------------------------------------------------------------

sessionCrudRoutes.put("/:userId/:bookId/:sessionId", async (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");
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
  db.update(userBookSessions)
    .set(updates)
    .where(
      and(
        eq(userBookSessions.id, sessionId),
        eq(userBookSessions.userId, userId),
        eq(userBookSessions.bookId, bookId),
      ),
    )
    .run();

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /sessions/:userId/:bookId/:sessionId — soft-delete a session
// ---------------------------------------------------------------------------

sessionCrudRoutes.delete("/:userId/:bookId/:sessionId", (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");
  const sessionId = Number(c.req.param("sessionId"));

  const db = getDb();
  db.update(userBookSessions)
    .set({ isActive: 0 })
    .where(
      and(
        eq(userBookSessions.id, sessionId),
        eq(userBookSessions.userId, userId),
        eq(userBookSessions.bookId, bookId),
      ),
    )
    .run();

  // Evict from memory
  closeSession(userId, bookId, sessionId);

  return c.json({ ok: true });
});
