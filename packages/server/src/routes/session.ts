import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getSession, closeSession, withSessionLock, getSessionByKey, withSessionLockByKey } from "../services/session-store.js";

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

/** Start or resume a reading session for a source */
sessionRoutes.post("/start", async (c) => {
  const body = await c.req.json<{
    sourceId?: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
    sessionKey?: string;
  }>();

  if (body.sessionKey) {
    const manager = getSessionByKey(body.sessionKey);
    if (!manager) return c.json({ error: "Session not found" }, 404);
    const state = manager.getSessionState(body.viewNodeId ?? null);
    return c.json(state);
  }

  const userId = body.userId ?? "default";
  const sessionId = body.sessionId !== undefined && body.sessionId !== null
    ? Number(body.sessionId)
    : undefined;
  const manager = await getSession(userId, body.sourceId!, sessionId);
  const state = manager.getSessionState(body.viewNodeId ?? null);
  return c.json(state);
});

/** View a specific scope in the tree (no AI call, just scoped messages) */
sessionRoutes.post("/view", async (c) => {
  const body = await c.req.json<{
    sourceId?: string;
    viewNodeId: string | null;
    userId?: string;
    sessionId?: number;
    sessionKey?: string;
  }>();

  if (body.sessionKey) {
    const manager = getSessionByKey(body.sessionKey);
    if (!manager) return c.json({ error: "Session not found" }, 404);
    const state = manager.getSessionState(body.viewNodeId);
    return c.json(state);
  }

  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  const manager = await getSession(userId, body.sourceId!, sessionId);
  const state = manager.getSessionState(body.viewNodeId);
  return c.json(state);
});

/** Send a user message — the core interaction */
sessionRoutes.post("/message", async (c) => {
  const body = await c.req.json<{
    sourceId?: string;
    message: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
    sessionKey?: string;
    forceBranch?: boolean;
  }>();

  const opts = { forceBranch: body.forceBranch };

  if (body.sessionKey) {
    const result = await withSessionLockByKey(body.sessionKey, async (manager) => {
      return manager.handleMessage(body.message, body.viewNodeId ?? null, opts);
    });
    return c.json(result);
  }

  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  const result = await withSessionLock(userId, body.sourceId!, sessionId, async (manager) => {
    return manager.handleMessage(body.message, body.viewNodeId ?? null, opts);
  });
  return c.json(result);
});

/** Stream a message response via SSE (for real-time AI responses) */
sessionRoutes.post("/message/stream", async (c) => {
  const body = await c.req.json<{
    sourceId?: string;
    message: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
    sessionKey?: string;
    forceBranch?: boolean;
  }>();

  /** Persist token usage from an onDone result to the database. */
  const persistUsage = async (
    result: Record<string, unknown>,
    opts: { userId: string; sessionId?: number; category?: string },
  ) => {
    const usage = result.usage as Record<string, unknown> | undefined;
    if (!usage) return;
    try {
      const { getDb, messageUsage } = await import("../db/index.js");
      const db = await getDb();
      await db.insert(messageUsage).values({
        sessionId: opts.sessionId ?? null,
        userId: opts.userId,
        category: opts.category ?? "session",
        nodeId: String(result.activeNodeId ?? ""),
        model: String(usage.model ?? ""),
        provider: String(usage.provider ?? ""),
        inputTokens: Number(usage.input) || 0,
        outputTokens: Number(usage.output) || 0,
        cacheReadTokens: Number(usage.cacheRead) || 0,
        cacheWriteTokens: Number(usage.cacheWrite) || 0,
        totalTokens: Number(usage.totalTokens) || 0,
        costTotal: usage.cost ? Number((usage.cost as any).total) || null : null,
        createdAt: new Date().toISOString(),
      }).run();
    } catch (err) {
      console.warn("[session] Failed to persist token usage:", err);
    }
  };

  /** Shared streaming callbacks factory */
  const makeCallbacks = (
    stream: Parameters<Parameters<typeof streamSSE>[1]>[0],
    usageOpts: { userId: string; sessionId?: number; category?: string },
  ) => ({
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
    onToolResult: async (info: { toolName: string; result: unknown; isError: boolean }) => {
      await stream.writeSSE({
        data: JSON.stringify({ type: "tool_result", toolName: info.toolName, result: info.result, isError: info.isError }),
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
      await persistUsage(result, usageOpts);
      await stream.writeSSE({
        data: JSON.stringify({ type: "done", ...result }),
      });
    },
  });

  return streamSSE(c, async (stream) => {
    // Abort in-flight LLM generation when the client disconnects
    const abortController = new AbortController();
    stream.onAbort(() => abortController.abort());

    try {
      const opts = { forceBranch: body.forceBranch, signal: abortController.signal };
      const onQueued = () => {
        stream.writeSSE({ data: JSON.stringify({ type: "queued" }) });
      };

      if (body.sessionKey) {
        const userId = extractUserId(body);
        // Determine category from sessionKey prefix (e.g. "router:shuo:123")
        const category = body.sessionKey.startsWith("router:") ? "router" : "session";
        await withSessionLockByKey(body.sessionKey, async (manager) => {
          await manager.handleMessageStreaming(body.message, body.viewNodeId ?? null, makeCallbacks(stream, { userId, category }), opts);
        }, onQueued);
      } else {
        const userId = extractUserId(body);
        const sessionId = extractSessionId(body);
        await withSessionLock(userId, body.sourceId!, sessionId, async (manager) => {
          await manager.handleMessageStreaming(body.message, body.viewNodeId ?? null, makeCallbacks(stream, { userId, sessionId }), opts);
        }, onQueued);
      }
    } catch (err) {
      // Send error event to client before closing the stream
      const message = err instanceof Error ? err.message : "Unknown error";
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", error: message }),
      });
    }
  });
});

/** Navigate to a specific node (from tree panel or TOC click) */
sessionRoutes.post("/navigate", async (c) => {
  const body = await c.req.json<{
    sourceId: string;
    targetNodeId: string;
    summarizeCurrent?: boolean;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  const manager = await getSession(userId, body.sourceId, sessionId);
  const state = await manager.navigateTo(body.targetNodeId, {
    summarize: body.summarizeCurrent ?? true,
  });
  // After navigation, scope the view to the target node
  const scopedState = manager.getSessionState(body.targetNodeId);
  return c.json(scopedState);
});

/** Immediately fork the conversation at a specific node (no message required) */
sessionRoutes.post("/fork", async (c) => {
  const body = await c.req.json<{
    sourceId: string;
    viewNodeId: string;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  const manager = await getSession(userId, body.sourceId, sessionId);
  const state = manager.forkAtNode(body.viewNodeId);
  return c.json(state);
});

/** Navigate from a TOC entry (creates node if needed) */
sessionRoutes.post("/navigate/toc", async (c) => {
  const body = await c.req.json<{
    sourceId: string;
    outlineEntryLine: number;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  const manager = await getSession(userId, body.sourceId, sessionId);
  const state = await manager.navigateToOutlineEntry(body.outlineEntryLine);
  return c.json(state);
});

/** Get the full tree for the tree panel */
sessionRoutes.get("/tree/:userId/:sourceId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = extractSessionIdFromQuery(c);
  const manager = await getSession(userId, sourceId, sessionId);
  const tree = manager.getTreeView();
  return c.json(tree);
});

/** Get the current breadcrumb path */
sessionRoutes.get("/breadcrumb/:userId/:sourceId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = extractSessionIdFromQuery(c);
  const manager = await getSession(userId, sourceId, sessionId);
  const breadcrumb = manager.getBreadcrumb();
  return c.json({ breadcrumb });
});

/** Close a session (user leaves the source) */
sessionRoutes.post("/close", async (c) => {
  const body = await c.req.json<{ sourceId: string; userId?: string; sessionId?: number }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  closeSession(userId, body.sourceId, sessionId);
  return c.json({ ok: true });
});

/** Reset a session — clears all history and starts fresh */
sessionRoutes.post("/reset", async (c) => {
  const body = await c.req.json<{ sourceId: string; userId?: string; sessionId?: number }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  closeSession(userId, body.sourceId, sessionId);

  // Deactivate DB session records so loadOrCreate won't resume
  try {
    const { eq, and } = await import("drizzle-orm");
    const { getDb, userSessions } = await import("../db/index.js");
    const db = await getDb();

    if (sessionId !== undefined) {
      // Reset a specific session
      await db.update(userSessions)
        .set({ isActive: 0 })
        .where(eq(userSessions.id, sessionId))
        .run();
    } else {
      // Legacy: reset all sessions for user+source
      await db.update(userSessions)
        .set({ isActive: 0 })
        .where(
          and(
            eq(userSessions.userId, userId),
            eq(userSessions.sourceId, body.sourceId),
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
    sourceId: string;
    nodeId: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  const manager = await getSession(userId, body.sourceId, sessionId);
  const result = manager.deleteNode(body.nodeId, body.viewNodeId ?? null);
  return c.json(result);
});

/** Rename a node in the session tree */
sessionRoutes.post("/rename-node", async (c) => {
  const body = await c.req.json<{
    sourceId: string;
    nodeId: string;
    newLabel: string;
    viewNodeId?: string | null;
    userId?: string;
    sessionId?: number;
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);
  const manager = await getSession(userId, body.sourceId, sessionId);
  const result = manager.renameNode(body.nodeId, body.newLabel, body.viewNodeId ?? null);
  return c.json(result);
});

/** Update session configuration */
sessionRoutes.put("/config/:userId/:sourceId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const sessionId = extractSessionIdFromQuery(c);
  const config = await c.req.json();
  const manager = await getSession(userId, sourceId, sessionId);
  manager.updateConfig(config);
  return c.json({ ok: true });
});

/** Summarize the current branch and save as memo (SSE stream) */
sessionRoutes.post("/summarize-branch", async (c) => {
  const body = await c.req.json<{
    sourceId: string;
    viewNodeId: string;
    userId?: string;
    sessionId?: number;
    breadcrumbLabels?: string[];
  }>();
  const userId = extractUserId(body);
  const sessionId = extractSessionId(body);

  return streamSSE(c, async (stream) => {
    try {
      // 1. Get the active session and extract scoped messages
      const manager = await getSession(userId, body.sourceId, sessionId);
      const state = manager.getSessionState(body.viewNodeId);
      const branchMessages = state.messages ?? [];

      if (branchMessages.length === 0) {
        await stream.writeSSE({ data: JSON.stringify({ type: "error", error: "No messages in this branch to summarize" }) });
        return;
      }

      // 2. Format branch messages into a transcript
      const transcript = branchMessages
        .map((m) => `[${m.role === "user" ? "User" : "Assistant"}]: ${m.content}`)
        .join("\n\n");

      const branchLabel = body.breadcrumbLabels?.slice(-1)[0] || "this branch";
      const topicPath = body.breadcrumbLabels?.join(" > ") || "";

      const prompt = `You are summarizing a branch of a tree-structured conversation. Below is the COMPLETE transcript of ONLY this branch — nothing else. Produce a structured summary covering the key points, insights, and conclusions.${topicPath ? `\n\nBranch path: ${topicPath}` : ""}\n\n--- TRANSCRIPT START ---\n${transcript}\n--- TRANSCRIPT END ---\n\nWrite a concise, well-structured summary in markdown. Use headings for major topics. Be specific — include names, numbers, and key details.`;

      // 3. Create ephemeral in-memory AI session for one-shot summarization
      const { createAgentSession, SessionManager } = await import("@earendil-works/pi-coding-agent");
      const { configureModelRegistry } = await import("@pi-tree/core");
      const { getServerConfig } = await import("../config.js");
      const serverConfig = getServerConfig();
      const { join } = await import("node:path");

      const repoRoot = join(import.meta.dirname, "../../..");
      const { authStorage, modelRegistry, selectedModel } = configureModelRegistry({
        ...serverConfig,
        readingModel: serverConfig.lookupModel || serverConfig.readingModel,
      });

      const { session: agent } = await createAgentSession({
        cwd: repoRoot,
        tools: [],
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
        ...(selectedModel ? { model: selectedModel } : {}),
      });

      // 4. Stream the AI response
      let fullResponse = "";
      let chain = Promise.resolve();

      const unsubscribe = agent.subscribe((event: any) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        ) {
          const delta = event.assistantMessageEvent.delta ?? "";
          fullResponse += delta;
          chain = chain.then(() =>
            stream.writeSSE({ data: JSON.stringify({ type: "token", token: delta }) })
          );
        }
      });

      try {
        await agent.prompt(prompt);
        await chain;
      } finally {
        unsubscribe();
        agent.dispose();
      }

      // 5. Save as memo
      const { MemoService } = await import("../services/memo-service.js");
      const memoService = MemoService.getInstance();
      const title = branchLabel !== "this branch"
        ? `Summary: ${branchLabel}`
        : `Branch Summary — ${new Date().toLocaleDateString()}`;

      const memo = await memoService.create(userId, {
        title,
        content: fullResponse,
        sourceId: body.sourceId,
        sessionId: sessionId ?? state.sessionId ?? undefined,
        origin: "command",
        tags: ["summary"],
      });

      // 6. Background-enrich the memo (title + tags from AI)
      const sourceTitle = body.sourceId.replace(/_/g, " ");
      memoService.enrich(userId, memo.id, {
        sourceTitle,
        topicPath,
      }).catch(() => {});

      await stream.writeSSE({
        data: JSON.stringify({ type: "done", memo }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[summarize-branch] Error:", err);
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", error: message }),
      });
    }
  });
});
