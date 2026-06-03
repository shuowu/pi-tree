/**
 * PiSession — integration layer between pi-reader and Pi SDK.
 *
 * Pi handles: session storage, tree structure, AI responses, compaction,
 *             tool execution, streaming, context building.
 * We handle:  reading-specific metadata (topic labels, book anchors),
 *             stored as CustomEntry in Pi's session JSONL.
 *
 * Architecture: SDK mode (not RPC) — we need SessionManager's tree API.
 */

import { join } from "node:path";
import type { BookAnchor } from "@pi-reader/shared";
import {
  createAgentSession,
  getAgentDir,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
  type AgentSession,
  type AgentSessionEvent,
  type SessionEntry,
  type CustomEntry,
} from "@earendil-works/pi-coding-agent";

// SessionTreeNode is not exported from the main barrel — define locally
interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
}

// ---------------------------------------------------------------------------
// Custom entry types stored in Pi session
// ---------------------------------------------------------------------------

const CUSTOM_TYPE = "pi-reader";

export interface TopicMeta {
  kind: "topic_node";
  label: string;
  source: "outline" | "user" | "auto";
  bookAnchor?: BookAnchor;
  status: "active" | "completed" | "abandoned";
}

export interface SectionStatusMeta {
  kind: "section_status";
  targetEntryId: string;
  newStatus: "active" | "completed" | "abandoned";
}

export type PiReaderData = TopicMeta | SectionStatusMeta;

// ---------------------------------------------------------------------------
// PiSession
// ---------------------------------------------------------------------------

export class PiSession {
  private topicCache: Map<string, TopicMeta> = new Map();

  private constructor(
    private sm: SessionManager,
    private agent: AgentSession | null,
    private bookId: string,
    private libraryPath: string,
  ) {
    // Index existing custom entries on load
    this.rebuildTopicCache();
  }

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  static async create(
    bookId: string,
    libraryPath: string,
    options?: { resumeSession?: string },
  ): Promise<PiSession> {
    const piBooksCwd = join(libraryPath, "..");

    // Session storage: each book gets its own session directory
    const sessionDir = join(libraryPath, bookId, ".sessions");

    let sm: SessionManager;
    if (options?.resumeSession) {
      sm = SessionManager.open(options.resumeSession, sessionDir);
    } else {
      sm = SessionManager.create(piBooksCwd, sessionDir);
    }

    // Try to create a full agent session. Falls back to session-only mode
    // if auth is not configured (no API keys).
    let agent: AgentSession | null = null;
    try {
      const authStorage = AuthStorage.create();
      const modelRegistry = ModelRegistry.create(authStorage);

      // ResourceLoader auto-discovers .pi/skills/ and .pi/extensions/
      // from piBooksCwd — loads interactive-reading, book-outline, etc.
      const agentDir = getAgentDir();
      const resourceLoader = new DefaultResourceLoader({
        cwd: piBooksCwd,
        agentDir,
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        cwd: piBooksCwd,
        tools: ["read", "grep", "find", "ls"], // read-only for book reading
        resourceLoader,
        sessionManager: sm,
        settingsManager: SettingsManager.create(piBooksCwd),
        authStorage,
        modelRegistry,
      });

      agent = session;
    } catch (err) {
      console.warn(
        `[pi-reader] Could not create agent session (missing API key?): ${err}`,
      );
      console.warn(`[pi-reader] Running in session-only mode (no AI responses)`);
    }

    const piSession = new PiSession(sm, agent, bookId, libraryPath);

    // If this is a fresh session, create the root topic node
    if (!options?.resumeSession) {
      piSession.registerTopicNode(sm.getLeafId()!, {
        kind: "topic_node",
        label: bookId,
        source: "auto",
        status: "active",
      });
    }

    return piSession;
  }

  // -------------------------------------------------------------------------
  // Core: Send message → get AI response
  // -------------------------------------------------------------------------

  /**
   * Send a message and wait for the full response.
   * Returns the assistant's response text.
   */
  async sendMessage(message: string): Promise<{
    response: string;
    entryId: string;
  }> {
    if (!this.agent) {
      // Session-only mode: no AI, just record the message
      return this.sendMessageNoAgent(message);
    }

    // Collect the full response via events
    let fullResponse = "";
    let responseEntryId = "";

    const unsubscribe = this.agent.subscribe((event: AgentSessionEvent) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        fullResponse += event.assistantMessageEvent.delta ?? "";
      }
      if (event.type === "message_end" && event.message) {
        // Capture the entry ID from the session manager
        const leaf = this.sm.getLeafEntry();
        if (leaf) responseEntryId = leaf.id;
      }
    });

    try {
      await this.agent.prompt(message);
    } finally {
      unsubscribe();
    }

    return { response: fullResponse, entryId: responseEntryId };
  }

  /**
   * Send a message with streaming callbacks.
   */
  async sendMessageStreaming(
    message: string,
    onToken: (token: string) => Promise<void>,
  ): Promise<{ response: string; entryId: string }> {
    if (!this.agent) {
      return this.sendMessageNoAgent(message);
    }

    let fullResponse = "";
    let responseEntryId = "";

    const unsubscribe = this.agent.subscribe(
      async (event: AgentSessionEvent) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        ) {
          const delta = event.assistantMessageEvent.delta ?? "";
          fullResponse += delta;
          await onToken(delta);
        }
        if (event.type === "message_end") {
          const leaf = this.sm.getLeafEntry();
          if (leaf) responseEntryId = leaf.id;
        }
      },
    );

    try {
      await this.agent.prompt(message);
    } finally {
      unsubscribe();
    }

    return { response: fullResponse, entryId: responseEntryId };
  }

  /**
   * Subscribe to all agent events (for SSE forwarding to client).
   */
  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    if (!this.agent) return () => {};
    return this.agent.subscribe(listener);
  }

  // -------------------------------------------------------------------------
  // Tree operations — thin wrappers over SessionManager
  // -------------------------------------------------------------------------

  /**
   * Branch from a specific entry to start a new topic.
   */
  branchAt(entryId: string, meta: Omit<TopicMeta, "kind">): string {
    this.sm.branch(entryId);

    const customId = this.sm.appendCustomEntry(CUSTOM_TYPE, {
      ...meta,
      kind: "topic_node" as const,
    } satisfies TopicMeta);

    this.topicCache.set(customId, { ...meta, kind: "topic_node" });
    this.sm.appendLabelChange(customId, meta.label);

    return customId;
  }

  /**
   * Branch from current position with a summary of the abandoned branch.
   */
  branchWithSummary(
    targetEntryId: string,
    summary: string,
    meta?: Omit<TopicMeta, "kind">,
  ): string {
    const summaryId = this.sm.branchWithSummary(targetEntryId, summary);

    if (meta) {
      const customId = this.sm.appendCustomEntry(CUSTOM_TYPE, {
        ...meta,
        kind: "topic_node" as const,
      } satisfies TopicMeta);
      this.topicCache.set(customId, { ...meta, kind: "topic_node" });
      return customId;
    }

    return summaryId;
  }

  /**
   * Compact context for the current branch.
   */
  async compact(_customInstructions?: string): Promise<string> {
    // TODO: Use the agent's compact method for LLM-powered compaction.
    // For now, create a placeholder compaction entry.
    const summary = _customInstructions
      ? `Compaction: ${_customInstructions}`
      : "Compaction summary";
    const leafId = this.sm.getLeafId() ?? "";
    return this.sm.appendCompaction(summary, leafId, 0);
  }

  // -------------------------------------------------------------------------
  // Tree reading
  // -------------------------------------------------------------------------

  /**
   * Get the full tree with our topic metadata overlaid.
   */
  getAnnotatedTree(): AnnotatedTreeNode[] {
    const piTree = this.sm.getTree();
    return piTree.map((node) => this.annotateNode(node));
  }

  /**
   * Get breadcrumb (path from root to current leaf).
   */
  getBreadcrumb(): Array<{ entryId: string; label: string }> {
    const leafId = this.sm.getLeafId();
    if (!leafId) return [];

    const path = this.sm.getBranch(leafId);
    const crumbs: Array<{ entryId: string; label: string }> = [];

    for (const entry of path) {
      const meta = this.getTopicMeta(entry.id);
      if (meta) {
        crumbs.push({ entryId: entry.id, label: meta.label });
      }
    }

    return crumbs;
  }

  /**
   * Get messages on the current branch.
   */
  getCurrentMessages(): Array<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
  }> {
    const leafId = this.sm.getLeafId();
    if (!leafId) return [];

    const path = this.sm.getBranch(leafId);
    return path
      .filter((e) => e.type === "message" && "message" in e)
      .map((e) => {
        const msg = (e as any).message;
        return {
          id: e.id,
          role: msg.role,
          content: Array.isArray(msg.content)
            ? msg.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("")
            : String(msg.content ?? ""),
          timestamp: e.timestamp,
        };
      });
  }

  getSessionFile(): string {
    return this.sm.getSessionFile() ?? "";
  }

  getSessionId(): string {
    return this.sm.getSessionId();
  }

  getLeafId(): string | null {
    return this.sm.getLeafId();
  }

  // -------------------------------------------------------------------------
  // Metadata management
  // -------------------------------------------------------------------------

  registerTopicNode(entryId: string, meta: TopicMeta): void {
    this.topicCache.set(entryId, meta);
    this.sm.appendCustomEntry(CUSTOM_TYPE, meta);
  }

  updateStatus(entryId: string, status: "active" | "completed" | "abandoned"): void {
    // Append-only: store a status update entry
    this.sm.appendCustomEntry(CUSTOM_TYPE, {
      kind: "section_status",
      targetEntryId: entryId,
      newStatus: status,
    } satisfies SectionStatusMeta);
  }

  private rebuildTopicCache(): void {
    this.topicCache.clear();
    const statusOverrides = new Map<string, string>();

    for (const entry of this.sm.getEntries()) {
      if (entry.type !== "custom") continue;
      const custom = entry as CustomEntry;
      if (custom.customType !== CUSTOM_TYPE) continue;

      const data = custom.data as PiReaderData;
      if (data.kind === "topic_node") {
        this.topicCache.set(entry.id, data);
      } else if (data.kind === "section_status") {
        statusOverrides.set(data.targetEntryId, data.newStatus);
      }
    }

    // Apply status overrides (latest-wins already handled by iteration order)
    for (const [targetId, status] of statusOverrides) {
      const meta = this.topicCache.get(targetId);
      if (meta) {
        meta.status = status as TopicMeta["status"];
      }
    }
  }

  private getTopicMeta(entryId: string): TopicMeta | null {
    if (this.topicCache.has(entryId)) {
      return this.topicCache.get(entryId)!;
    }

    // Check labels as fallback
    const label = this.sm.getLabel(entryId);
    if (label) {
      return {
        kind: "topic_node",
        label,
        source: "auto",
        status: "active",
      };
    }

    return null;
  }

  private annotateNode(piNode: SessionTreeNode): AnnotatedTreeNode {
    const meta = this.getTopicMeta(piNode.entry.id);
    const leafId = this.sm.getLeafId();
    const messageCount = this.countMessages(piNode);

    return {
      entryId: piNode.entry.id,
      parentId: piNode.entry.parentId ?? "",
      label: meta?.label ?? this.inferLabel(piNode.entry),
      source: meta?.source ?? "auto",
      status: meta?.status ?? "active",
      bookAnchor: meta?.bookAnchor,
      messageCount,
      isCurrent: piNode.entry.id === leafId,
      summary:
        piNode.entry.type === "branch_summary"
          ? (piNode.entry as any).summary
          : undefined,
      children: piNode.children.map((c) => this.annotateNode(c)),
    };
  }

  private inferLabel(entry: SessionEntry): string {
    if (entry.type === "message" && "message" in entry) {
      const msg = (entry as any).message;
      if (msg.role === "user") {
        const text = Array.isArray(msg.content)
          ? (msg.content as Array<{type: string; text?: string}>)
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("")
          : String(msg.content ?? "");
        return text.slice(0, 60) + (text.length > 60 ? "…" : "");
      }
    }
    return `Entry ${entry.id.slice(0, 8)}`;
  }

  private countMessages(node: SessionTreeNode): number {
    let count = 0;
    if (
      node.entry.type === "message" &&
      "message" in node.entry &&
      (node.entry as any).message?.role === "user"
    ) {
      count++;
    }
    for (const child of node.children) {
      count += this.countMessages(child);
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // No-agent fallback (when Pi SDK auth is not configured)
  // -------------------------------------------------------------------------

  private sendMessageNoAgent(message: string): {
    response: string;
    entryId: string;
  } {
    const response = `[No AI configured] Message received: "${message}". Configure a provider API key to enable AI responses.`;
    const leafId = this.sm.getLeafId() ?? "";
    return { response, entryId: leafId };
  }
}

// ---------------------------------------------------------------------------
// Annotated tree node (Pi tree + our metadata)
// ---------------------------------------------------------------------------

export interface AnnotatedTreeNode {
  entryId: string;
  parentId: string;
  label: string;
  source: "outline" | "user" | "auto";
  status: "active" | "completed" | "abandoned";
  bookAnchor?: BookAnchor;
  messageCount: number;
  isCurrent: boolean;
  summary?: string;
  children: AnnotatedTreeNode[];
}
