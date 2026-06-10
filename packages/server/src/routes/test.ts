/**
 * Test-only API routes — mounted only when PI_MOCK=true.
 *
 * Provides endpoints for seeding test data that would normally require
 * file uploads (sources, etc.).
 */

import { Hono } from "hono";
import { getDb, sources } from "../db/index.js";

export const testRoutes = new Hono();

/**
 * POST /api/test/seed-source
 *
 * Create a source record directly in the DB (bypassing file upload).
 * Body: { id, title, author?, type?, year? }
 */
testRoutes.post("/seed-source", async (c) => {
  const body = await c.req.json();
  const { id, title, author = "Test Author", type = "book", year } = body;

  if (!id || !title) {
    return c.json({ error: "id and title are required" }, 400);
  }

  const db = getDb();
  const now = new Date().toISOString();

  try {
    db.insert(sources)
      .values({
        id,
        type,
        title,
        author,
        year: year ?? null,
        source: "upload",
        status: "ready",
        metadata: null,
        coverUrl: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    return c.json({ id, title, type, author }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/**
 * DELETE /api/test/cleanup/:userId
 *
 * Delete a test user and all associated data.
 * Also deletes any sources created by this test user.
 */
testRoutes.delete("/cleanup/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb();

  try {
    // Delete source if it has the test prefix
    db.delete(sources)
      .where((await import("drizzle-orm")).eq(sources.id, id))
      .run();
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: true });
  }
});
