import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getSession, closeSession } from "../services/session-store.js";

export const sessionRoutes = new Hono();

/** Start or resume a reading session for a book */
sessionRoutes.post("/start", async (c) => {
  const { bookId, viewNodeId } = await c.req.json<{
    bookId: string;
    viewNodeId?: string | null;
  }>();
  const manager = await getSession(bookId);
  const state = manager.getSessionState(viewNodeId ?? null);
  return c.json(state);
});

/** View a specific scope in the tree (no AI call, just scoped messages) */
sessionRoutes.post("/view", async (c) => {
  const { bookId, viewNodeId } = await c.req.json<{
    bookId: string;
    viewNodeId: string | null;
  }>();
  const manager = await getSession(bookId);
  const state = manager.getSessionState(viewNodeId);
  return c.json(state);
});

/** Send a user message — the core interaction */
sessionRoutes.post("/message", async (c) => {
  const { bookId, message, viewNodeId } = await c.req.json<{
    bookId: string;
    message: string;
    viewNodeId?: string | null;
  }>();

  const manager = await getSession(bookId);
  const result = await manager.handleMessage(message, viewNodeId ?? null);
  return c.json(result);
});

/** Stream a message response via SSE (for real-time AI responses) */
sessionRoutes.post("/message/stream", async (c) => {
  const { bookId, message, viewNodeId } = await c.req.json<{
    bookId: string;
    message: string;
    viewNodeId?: string | null;
  }>();

  const manager = await getSession(bookId);

  return streamSSE(c, async (stream) => {
    await manager.handleMessageStreaming(message, viewNodeId ?? null, {
      onToken: async (token: string) => {
        await stream.writeSSE({ data: JSON.stringify({ type: "token", token }) });
      },
      onTreeUpdate: async (update: Record<string, unknown>) => {
        await stream.writeSSE({
          data: JSON.stringify({ type: "tree_update", ...update }),
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
  const { bookId, targetNodeId, summarizeCurrent } = await c.req.json<{
    bookId: string;
    targetNodeId: string;
    summarizeCurrent?: boolean;
  }>();

  const manager = await getSession(bookId);
  const state = await manager.navigateTo(targetNodeId, {
    summarize: summarizeCurrent ?? true,
  });
  // After navigation, scope the view to the target node
  const scopedState = manager.getSessionState(targetNodeId);
  return c.json(scopedState);
});

/** Navigate from a TOC entry (creates node if needed) */
sessionRoutes.post("/navigate/toc", async (c) => {
  const { bookId, outlineEntryLine } = await c.req.json<{
    bookId: string;
    outlineEntryLine: number;
  }>();

  const manager = await getSession(bookId);
  const state = await manager.navigateToOutlineEntry(outlineEntryLine);
  return c.json(state);
});

/** Get the full tree for the tree panel */
sessionRoutes.get("/tree/:bookId", async (c) => {
  const bookId = c.req.param("bookId");
  const manager = await getSession(bookId);
  const tree = manager.getTreeView();
  return c.json(tree);
});

/** Get the current breadcrumb path */
sessionRoutes.get("/breadcrumb/:bookId", async (c) => {
  const bookId = c.req.param("bookId");
  const manager = await getSession(bookId);
  const breadcrumb = manager.getBreadcrumb();
  return c.json({ breadcrumb });
});

/** Close a session (user leaves the book) */
sessionRoutes.post("/close", async (c) => {
  const { bookId } = await c.req.json<{ bookId: string }>();
  closeSession(bookId);
  return c.json({ ok: true });
});

/** Update session configuration */
sessionRoutes.put("/config/:bookId", async (c) => {
  const bookId = c.req.param("bookId");
  const config = await c.req.json();
  const manager = await getSession(bookId);
  manager.updateConfig(config);
  return c.json({ ok: true });
});
