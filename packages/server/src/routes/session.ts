import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getSession, closeSession } from "../services/session-store.js";

export const sessionRoutes = new Hono();

/**
 * Extract userId from request body, defaulting to "default" for backward compat.
 */
function extractUserId(body: Record<string, unknown>): string {
  return (body.userId as string) ?? "default";
}

/**
 * Extract optional sessionId from request body.
 * Accepts both number and string (for JSON flexibility) — coerces to number.
 */
function extractSessionId(body: Record<string, unknown>): number | undefined {
  const raw = body.sessionId;
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extract optional sessionId from query params.
 */
function extractSessionIdFromQuery(c: { req: { query: (key: string) => string | undefined } }): number | undefined {
  const raw = c.req.query("sessionId");
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Start or resume a reading session for a book */
sessionRoutes.post("/start", async (c) => {
  const { bookId, viewNodeId, userId: rawUserId, sessionId: rawSessionId } = await c.req.json<{
    bookId: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = rawUserId ?? "default";
  const sessionId = rawSessionId !== undefined && rawSessionId !== null
    ? Number(rawSessionId)
    : undefined;
  const manager = await getSession(userId, bookId, sessionId);
  const state = manager.getSessionState(viewNodeId ?? null);
  return c.json(state);
});

/** View a specific scope in the tree (no AI call, just scoped messages) */
sessionRoutes.post("/view", async (c) => {
  const body = await c.req.json<{
    bookId: string;
    viewNodeId: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  const manager = await getSession(userId, body.bookId, sessionId);
  const state = manager.getSessionState(body.viewNodeId);
  return c.json(state);
});

/** Send a user message — the core interaction */
sessionRoutes.post("/message", async (c) => {
  const body = await c.req.json<{
    bookId: string;
    message: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  const manager = await getSession(userId, body.bookId, sessionId);
  const result = await manager.handleMessage(body.message, body.viewNodeId ?? null);
  return c.json(result);
});

/** Stream a message response via SSE (for real-time AI responses) */
sessionRoutes.post("/message/stream", async (c) => {
  const body = await c.req.json<{
    bookId: string;
    message: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  const manager = await getSession(userId, body.bookId, sessionId);

  return streamSSE(c, async (stream) => {
    await manager.handleMessageStreaming(body.message, body.viewNodeId ?? null, {
      onToken: async (token: string) => {
        await stream.writeSSE({ data: JSON.stringify({ type: "token", token }) });
      },
      onTurnEnd: async () => {
        await stream.writeSSE({ data: JSON.stringify({ type: "turn_end" }) });
      },
      onToolCall: async (info: { toolName: string; args: Record<string, unknown> }) => {
        await stream.writeSSE({
          data: JSON.stringify({ type: "tool_call", toolName: info.toolName, args: info.args }),
        });
      },
      onTreeUpdate: async (update: Record<string, unknown>) => {
        await stream.writeSSE({
          data: JSON.stringify({ type: "tree_update", ...update }),
        });
      },
      onCompaction: async (event: { type: string; reason: string }) => {
        await stream.writeSSE({
          data: JSON.stringify({ type: event.type, reason: event.reason }),
        });
      },
      onDone: async (result: Record<string, unknown>) => {
        await stream.writeSSE({
          data: JSON.stringify({ type: "done", ...result }),
        });
      },
    });
  });
});

/** Navigate to a specific node (from tree panel or TOC click) */
sessionRoutes.post("/navigate", async (c) => {
  const body = await c.req.json<{
    bookId: string;
    targetNodeId: string;
    summarizeCurrent?: boolean;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  const manager = await getSession(userId, body.bookId, sessionId);
  const state = await manager.navigateTo(body.targetNodeId, {
    summarize: body.summarizeCurrent ?? true,
  });
  // After navigation, scope the view to the target node
  const scopedState = manager.getSessionState(body.targetNodeId);
  return c.json(scopedState);
});

/** Navigate from a TOC entry (creates node if needed) */
sessionRoutes.post("/navigate/toc", async (c) => {
  const body = await c.req.json<{
    bookId: string;
    outlineEntryLine: number;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  const manager = await getSession(userId, body.bookId, sessionId);
  const state = await manager.navigateToOutlineEntry(body.outlineEntryLine);
  return c.json(state);
});

/** Get the full tree for the tree panel */
sessionRoutes.get("/tree/:userId/:bookId", async (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");
  const sessionId = extractSessionIdFromQuery(c);
  const manager = await getSession(userId, bookId, sessionId);
  const tree = manager.getTreeView();
  return c.json(tree);
});

/** Get the current breadcrumb path */
sessionRoutes.get("/breadcrumb/:userId/:bookId", async (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");
  const sessionId = extractSessionIdFromQuery(c);
  const manager = await getSession(userId, bookId, sessionId);
  const breadcrumb = manager.getBreadcrumb();
  return c.json({ breadcrumb });
});

/** Close a session (user leaves the book) */
sessionRoutes.post("/close", async (c) => {
  const body = await c.req.json<{ bookId: string; userId?: string; sessionId?: number }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  closeSession(userId, body.bookId, sessionId);
  return c.json({ ok: true });
});

/** Reset a session — clears all history and starts fresh */
sessionRoutes.post("/reset", async (c) => {
  const body = await c.req.json<{ bookId: string; userId?: string; sessionId?: number }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  closeSession(userId, body.bookId, sessionId);

  // Deactivate DB session records so loadOrCreate won't resume
  try {
    const { eq, and } = await import("drizzle-orm");
    const { getDb, userBookSessions } = await import("../db/index.js");
    const db = getDb();

    if (sessionId !== undefined) {
      // Reset a specific session
      db.update(userBookSessions)
        .set({ isActive: 0 })
        .where(eq(userBookSessions.id, sessionId))
        .run();
    } else {
      // Legacy: reset all sessions for user+book
      db.update(userBookSessions)
        .set({ isActive: 0 })
        .where(
          and(
            eq(userBookSessions.userId, userId),
            eq(userBookSessions.bookId, body.bookId),
          ),
        )
        .run();
    }
  } catch {
    // DB not available — fine
  }

  return c.json({ ok: true });
});

/** Soft-delete (abandon) a node in the session tree */
sessionRoutes.post("/delete-node", async (c) => {
  const body = await c.req.json<{
    bookId: string;
    nodeId: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  const manager = await getSession(userId, body.bookId, sessionId);
  const result = manager.deleteNode(body.nodeId, body.viewNodeId ?? null);
  return c.json(result);
});

/** Rename a node in the session tree */
sessionRoutes.post("/rename-node", async (c) => {
  const body = await c.req.json<{
    bookId: string;
    nodeId: string;
    newLabel: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  const manager = await getSession(userId, body.bookId, sessionId);
  const result = manager.renameNode(body.nodeId, body.newLabel, body.viewNodeId ?? null);
  return c.json(result);
});

/** Update session configuration */
sessionRoutes.put("/config/:userId/:bookId", async (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");
  const sessionId = extractSessionIdFromQuery(c);
  const config = await c.req.json();
  const manager = await getSession(userId, bookId, sessionId);
  manager.updateConfig(config);
  return c.json({ ok: true });
});
