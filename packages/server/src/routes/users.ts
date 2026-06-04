/**
 * User routes — CRUD for pi-reader users.
 *
 * Users are simple identity records (no auth). Each user gets their own
 * session directories and glossary entries per book.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb, users } from "../db/index.js";

export const userRoutes = new Hono();

/** List all users */
userRoutes.get("/", (c) => {
  const db = getDb();
  const allUsers = db.select().from(users).all();
  return c.json({ users: allUsers });
});

/** Get a single user */
userRoutes.get("/:userId", (c) => {
  const userId = c.req.param("userId");
  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

/** Create a new user */
userRoutes.post("/", async (c) => {
  const { id, displayName, avatarUrl } = await c.req.json<{
    id: string;
    displayName?: string;
    avatarUrl?: string;
  }>();

  if (!id) {
    return c.json({ error: "id is required" }, 400);
  }

  // Check for duplicate
  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (existing) {
    return c.json({ error: `User "${id}" already exists` }, 409);
  }

  const now = new Date().toISOString();
  const user = {
    id,
    displayName: displayName || id,
    avatarUrl: avatarUrl ?? null,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(users).values(user).run();
  return c.json(user, 201);
});

/** Update a user's display name or avatar */
userRoutes.put("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const { displayName, avatarUrl } = await c.req.json<{
    displayName?: string;
    avatarUrl?: string;
  }>();

  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  const updates: Record<string, string> = {
    updatedAt: new Date().toISOString(),
  };
  if (displayName !== undefined) updates.displayName = displayName;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

  db.update(users).set(updates).where(eq(users.id, userId)).run();

  const updated = db.select().from(users).where(eq(users.id, userId)).get();
  return c.json(updated);
});

/** Delete a user and cascade related data */
userRoutes.delete("/:userId", async (c) => {
  const userId = c.req.param("userId");

  const db = getDb();
  const existing = db.select().from(users).where(eq(users.id, userId)).get();
  if (!existing) {
    return c.json({ error: "User not found" }, 404);
  }

  // Cascade: remove related records manually (SQLite FK cascade is opt-in)
  const { userBookSessions, userBookConfig, userBookProgress, glossaryEntries } =
    await import("../db/index.js");

  db.delete(glossaryEntries).where(eq(glossaryEntries.userId, userId)).run();
  db.delete(userBookProgress).where(eq(userBookProgress.userId, userId)).run();
  db.delete(userBookConfig).where(eq(userBookConfig.userId, userId)).run();
  db.delete(userBookSessions).where(eq(userBookSessions.userId, userId)).run();
  db.delete(users).where(eq(users.id, userId)).run();

  return c.json({ ok: true });
});
