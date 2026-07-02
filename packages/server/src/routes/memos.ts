/**
 * Memo routes — CRUD, append, and full-text search for user memos.
 *
 * Mounted at `/api/memos`.
 */

import { Hono } from "hono";
import { MemoService } from "../services/memo-service.js";
import type { MemoCreate, MemoUpdate } from "@pi-tree/shared";

export const memoRoutes = new Hono();

/** List memos for a user (supports ?source=&tag=&pinned=&limit=&offset=) */
memoRoutes.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.query("source") || undefined;
  const tag = c.req.query("tag") || undefined;
  const pinnedParam = c.req.query("pinned");
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined;

  const pinned = pinnedParam === "true" ? true : pinnedParam === "false" ? false : undefined;

  const service = MemoService.getInstance();
  const items = await service.list(userId, { sourceId, tag, pinned, limit, offset });
  return c.json({ memos: items });
});

/** FTS5 search — must come before /:memoId to avoid param collision */
memoRoutes.get("/:userId/search", async (c) => {
  const userId = c.req.param("userId");
  const q = c.req.query("q") || "";
  const sourceId = c.req.query("source") || undefined;
  const tag = c.req.query("tag") || undefined;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!, 10) : undefined;

  if (!q) return c.json({ memos: [] });

  const service = MemoService.getInstance();
  const items = await service.search(userId, q, { sourceId, tag, limit, offset });
  return c.json({ memos: items });
});

/** AI-enrich a memo (generate title + tags) — must come before /:memoId GET */
memoRoutes.post("/:userId/:memoId/enrich", async (c) => {
  const userId = c.req.param("userId");
  const memoId = parseInt(c.req.param("memoId"), 10);
  if (!Number.isFinite(memoId)) return c.json({ error: "Invalid memo ID" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const { sourceTitle, topicPath, userNote } = body as { sourceTitle?: string; topicPath?: string; userNote?: string };

  const service = MemoService.getInstance();
  const memo = await service.enrich(userId, memoId, { sourceTitle, topicPath, userNote });
  if (!memo) return c.json({ error: "Memo not found or enrichment failed" }, 404);

  return c.json(memo);
});

/** Get a single memo */
memoRoutes.get("/:userId/:memoId", async (c) => {
  const userId = c.req.param("userId");
  const memoId = parseInt(c.req.param("memoId"), 10);
  if (!Number.isFinite(memoId)) return c.json({ error: "Invalid memo ID" }, 400);

  const service = MemoService.getInstance();
  const memo = await service.get(userId, memoId);
  if (!memo) return c.json({ error: "Not found" }, 404);

  return c.json(memo);
});

/** Create a new memo */
memoRoutes.post("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const body = await c.req.json<MemoCreate>();

  if (!body.title || !body.content) {
    return c.json({ error: "title and content are required" }, 400);
  }

  const service = MemoService.getInstance();
  const memo = await service.create(userId, body);
  return c.json(memo, 201);
});

/** Update a memo */
memoRoutes.put("/:userId/:memoId", async (c) => {
  const userId = c.req.param("userId");
  const memoId = parseInt(c.req.param("memoId"), 10);
  if (!Number.isFinite(memoId)) return c.json({ error: "Invalid memo ID" }, 400);

  const body = await c.req.json<MemoUpdate>();

  const service = MemoService.getInstance();
  const memo = await service.update(userId, memoId, body);
  if (!memo) return c.json({ error: "Not found" }, 404);

  return c.json(memo);
});

/** Delete a memo */
memoRoutes.delete("/:userId/:memoId", async (c) => {
  const userId = c.req.param("userId");
  const memoId = parseInt(c.req.param("memoId"), 10);
  if (!Number.isFinite(memoId)) return c.json({ error: "Invalid memo ID" }, 400);

  const service = MemoService.getInstance();
  const deleted = await service.remove(userId, memoId);
  if (!deleted) return c.json({ error: "Not found" }, 404);

  return c.json({ ok: true });
});

/** Append content to a memo */
memoRoutes.post("/:userId/:memoId/append", async (c) => {
  const userId = c.req.param("userId");
  const memoId = parseInt(c.req.param("memoId"), 10);
  if (!Number.isFinite(memoId)) return c.json({ error: "Invalid memo ID" }, 400);

  const body = await c.req.json<{ content: string; sourceId?: string }>();
  if (!body.content) return c.json({ error: "content is required" }, 400);

  const service = MemoService.getInstance();
  const memo = await service.append(userId, memoId, body.content, body.sourceId);
  if (!memo) return c.json({ error: "Not found" }, 404);

  return c.json(memo);
});
