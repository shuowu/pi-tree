import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { TreeManager } from "../services/tree-manager.js";

export const sessionRoutes = new Hono();

/** Start or resume a reading session for a book */
sessionRoutes.post("/start", async (c) => {
  const { bookId } = await c.req.json<{ bookId: string }>();
  const manager = await TreeManager.loadOrCreate(bookId);
  const state = manager.getSessionState();
  return c.json(state);
});

/** Send a user message — the core interaction */
sessionRoutes.post("/message", async (c) => {
  const { bookId, message } = await c.req.json<{
    bookId: string;
    message: string;
  }>();

  const manager = await TreeManager.loadOrCreate(bookId);

  // This is where the branch logic lives:
  // 1. Classify intent (continue vs go_deeper vs zoom_out vs ...)
  // 2. Execute tree operation if needed (branch / navigate / summarize)
  // 3. Send to Pi SDK for AI response
  // 4. Return updated state
  const result = await manager.handleMessage(message);
  return c.json(result);
});

/** Stream a message response via SSE (for real-time AI responses) */
sessionRoutes.post("/message/stream", async (c) => {
  const { bookId, message } = await c.req.json<{
    bookId: string;
    message: string;
  }>();

  const manager = await TreeManager.loadOrCreate(bookId);

  return streamSSE(c, async (stream) => {
    await manager.handleMessageStreaming(message, {
      onToken: async (token) => {
        await stream.writeSSE({ data: JSON.stringify({ type: "token", token }) });
      },
      onTreeUpdate: async (update) => {
        await stream.writeSSE({
          data: JSON.stringify({ type: "tree_update", ...update }),
        });
      },
      onDone: async (result) => {
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

  const manager = await TreeManager.loadOrCreate(bookId);
  const state = await manager.navigateTo(targetNodeId, {
    summarize: summarizeCurrent ?? true,
  });
  return c.json(state);
});

/** Navigate from a TOC entry (creates node if needed) */
sessionRoutes.post("/navigate/toc", async (c) => {
  const { bookId, outlineEntryLine } = await c.req.json<{
    bookId: string;
    outlineEntryLine: number;
  }>();

  const manager = await TreeManager.loadOrCreate(bookId);
  const state = await manager.navigateToOutlineEntry(outlineEntryLine);
  return c.json(state);
});

/** Get the full tree for the tree panel */
sessionRoutes.get("/tree/:bookId", async (c) => {
  const bookId = c.req.param("bookId");
  const manager = await TreeManager.loadOrCreate(bookId);
  const tree = manager.getTreeView();
  return c.json(tree);
});

/** Get the current breadcrumb path */
sessionRoutes.get("/breadcrumb/:bookId", async (c) => {
  const bookId = c.req.param("bookId");
  const manager = await TreeManager.loadOrCreate(bookId);
  const breadcrumb = manager.getBreadcrumb();
  return c.json({ breadcrumb });
});

/** Update session configuration */
sessionRoutes.put("/config/:bookId", async (c) => {
  const bookId = c.req.param("bookId");
  const config = await c.req.json();
  const manager = await TreeManager.loadOrCreate(bookId);
  manager.updateConfig(config);
  return c.json({ ok: true });
});
