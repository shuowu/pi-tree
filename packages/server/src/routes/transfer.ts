/**
 * Export / Import routes — session sharing and backup.
 *
 * Mounted at `/api/export` and `/api/import` (see app.ts).
 *
 * Export formats:
 * - `html`  — standalone read-only viewer (tree nav + messages), no server
 *             needed to open it. Sanitized: no user IDs, paths, or costs.
 * - `jsonl` — re-importable bundle: export header line + raw session JSONL.
 *
 * Import accepts a `jsonl` bundle as the raw request body and recreates the
 * session (and a minimal source row if the source doesn't exist locally).
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { existsSync } from "node:fs";
import { getSession } from "../services/session-store.js";
import {
  loadExportContext,
  buildJsonlBundle,
  buildSnapshot,
  importSessionBundle,
  exportFilename,
} from "../services/export-service.js";
import { renderExportHtml } from "../services/export-template.js";

export const exportRoutes = new Hono();
export const importRoutes = new Hono();

function parseSessionId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: "Invalid session id" });
  }
  return id;
}

// ---------------------------------------------------------------------------
// GET /api/export/:userId/:sourceId/:sessionId/jsonl
// ---------------------------------------------------------------------------

exportRoutes.get("/:userId/:sourceId/:sessionId/jsonl", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = parseSessionId(c.req.param("sessionId"));

  let ctx;
  try {
    ctx = await loadExportContext(userId, sourceId, sessionId);
  } catch (err) {
    throw new HTTPException(404, { message: (err as Error).message });
  }

  let bundle: string;
  try {
    bundle = buildJsonlBundle(ctx);
  } catch (err) {
    throw new HTTPException(400, { message: (err as Error).message });
  }

  c.header("Content-Type", "application/jsonl; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${exportFilename(ctx.sessionRow.title, "pi-tree.jsonl")}"`,
  );
  return c.body(bundle);
});

// ---------------------------------------------------------------------------
// GET /api/export/:userId/:sourceId/:sessionId/html
// ---------------------------------------------------------------------------

exportRoutes.get("/:userId/:sourceId/:sessionId/html", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = parseSessionId(c.req.param("sessionId"));

  let ctx;
  try {
    ctx = await loadExportContext(userId, sourceId, sessionId);
  } catch (err) {
    throw new HTTPException(404, { message: (err as Error).message });
  }

  // Guard before getSession(): loading a session whose file is missing
  // (e.g. a "pending-*" placeholder) would silently create a fresh JSONL.
  if (!existsSync(ctx.sessionRow.sessionFile)) {
    throw new HTTPException(400, { message: "Session has no conversation content yet" });
  }

  const manager = await getSession(userId, sourceId, sessionId);
  const { tree, contents } = manager.getExportSnapshot();

  // Optional branch scoping — export only the subtree rooted at nodeId
  const nodeId = c.req.query("nodeId")?.trim() || undefined;
  let snapshot;
  try {
    snapshot = buildSnapshot(ctx, tree, contents, nodeId);
  } catch (err) {
    throw new HTTPException(404, { message: (err as Error).message });
  }
  const html = renderExportHtml(snapshot);

  c.header("Content-Type", "text/html; charset=utf-8");
  const download = c.req.query("download");
  if (download !== "false") {
    const stem = snapshot.branch
      ? `${ctx.sessionRow.title} ${snapshot.branch.label}`
      : ctx.sessionRow.title;
    c.header(
      "Content-Disposition",
      `attachment; filename="${exportFilename(stem, "html")}"`,
    );
  }
  return c.body(html);
});

// ---------------------------------------------------------------------------
// POST /api/import/:userId — body is the raw jsonl bundle text
// ---------------------------------------------------------------------------

importRoutes.post("/:userId", async (c) => {
  const userId = c.req.param("userId");
  const text = await c.req.text();
  if (!text.trim()) {
    throw new HTTPException(400, { message: "Empty import file" });
  }

  try {
    const session = await importSessionBundle(userId, text);
    return c.json(session, 201);
  } catch (err) {
    throw new HTTPException(400, { message: (err as Error).message });
  }
});
