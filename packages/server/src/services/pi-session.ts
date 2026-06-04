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

      // Model selection: PI_MODEL env var → default to glm-5-turbo for speed
      const modelId = process.env.PI_MODEL ?? "glm-5-turbo";
      const allModels = modelRegistry.getAll();
      const selectedModel = allModels.find((m) => m.id === modelId);
      if (selectedModel) {
        console.log(`[pi-session] Using model: ${selectedModel.provider}/${selectedModel.id}`);
      } else {
        console.log(`[pi-session] Model "${modelId}" not found, using SDK default. Available: ${allModels.map((m) => `${m.provider}/${m.id}`).join(", ")}`);
      }

      const { session } = await createAgentSession({
        cwd: piBooksCwd,
        tools: ["read", "grep", "find", "ls"], // read-only for book reading
        resourceLoader,
        sessionManager: sm,
        settingsManager: SettingsManager.create(piBooksCwd),
        authStorage,
        modelRegistry,
        ...(selectedModel ? { model: selectedModel } : {}),
      });

      agent = session;
    } catch (err) {
      console.warn(
        `[pi-reader] Could not create agent session (missing API key?): ${err}`,
      );
      console.warn(`[pi-reader] Running in session-only mode (no AI responses)`);
    }

    const piSession = new PiSession(sm, agent, bookId, libraryPath);

    // If this is a fresh session, set up book context
    if (!options?.resumeSession) {
      piSession.registerTopicNode(sm.getLeafId()!, {
        kind: "topic_node",
        label: bookId,
        source: "auto",
        status: "active",
      });

      // Inject book context so the AI knows which book to focus on
      if (agent) {
        const bookDir = join(libraryPath, bookId);
        const contextMsg = [
          `[SYSTEM CONTEXT — Book Session]`,
          `You are now in a dedicated reading session for a specific book.`,
          `Book directory: ${bookDir}`,
          `Book ID: ${bookId}`,
          ``,
          `IMPORTANT: Focus ONLY on this book. Do NOT list other books in the library.`,
          `Do NOT ask which book to read — the book is already selected.`,
          `The book's markdown content is in: ${bookDir}/markdown/`,
          `The book's analysis/outline is in: ${bookDir}/analysis/`,
          ``,
          `Start by reading the outline from ${bookDir}/analysis/outline.md if it exists,`,
          `then give the user a chapter briefing for this book.`,
        ].join("\n");

        await agent.prompt(contextMsg);
      }
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

  /**
   * Ephemeral lookup: send a prompt to AI without keeping it in the main thread.
   * Creates a temporary branch, prompts the AI, then restores the original leaf.
   * The lookup entries remain in the session file but are orphaned from the main tree.
   */
  async ephemeralLookup(
    prompt: string,
    onToken: (token: string) => Promise<void>,
  ): Promise<string> {
    if (!this.agent) {
      return "Dictionary lookup unavailable — no AI agent configured.";
    }

    // Save current position
    const currentLeaf = this.sm.getLeafEntry();
    if (!currentLeaf) {
      return "No session context for lookup.";
    }

    let fullResponse = "";

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
      },
    );

    try {
      // Branch to a temporary location (the lookup will append here)
      this.sm.branch(currentLeaf.id);
      await this.agent.prompt(prompt);
    } finally {
      unsubscribe();
      // Restore original leaf position so the main conversation continues from where it was
      this.sm.branch(currentLeaf.id);
    }

    return fullResponse;
  }

  // -------------------------------------------------------------------------
  // Tree operations — thin wrappers over SessionManager
  // -------------------------------------------------------------------------

  /**
   * Simple branch: move the leaf pointer to a specific entry.
   * The next append (user message) becomes a child of this entry.
   * Does NOT create a topic_node — use this when the user message IS the label.
   */
  simpleBranch(entryId: string): void {
    this.sm.branch(entryId);
  }

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
   * Get a clean, conversation-oriented tree.
   *
   * The raw Pi tree has a node per entry (every message, tool result, custom
   * entry, etc.). This method builds a simplified tree that shows:
   * - The book root
   * - Each user "turn" (user message → assistant response) as a single node
   * - Branch points where conversations diverge
   *
   * Internal entries (tool results, custom metadata, compactions) are hidden.
   */
  getAnnotatedTree(): AnnotatedTreeNode[] {
    const piTree = this.sm.getTree();
    if (piTree.length === 0) return [];

    // Build a flat list of all conversation turns (user messages)
    // and find the branch topology from them
    const result = this.buildConversationTree(piTree);
    return result;
  }

  private buildConversationTree(piNodes: SessionTreeNode[]): AnnotatedTreeNode[] {
    return piNodes
      .map((node) => this.buildConversationNode(node))
      .filter((n): n is AnnotatedTreeNode => n !== null);
  }

  /**
   * Walk the Pi tree and build a conversation node.
   * - Skip non-message entries (tool results, custom, compaction, etc.)
   * - For user messages: show as a turn node labeled with the user's text
   * - For assistant messages: show as response nodes (these are branch points!)
   * - Skip tool results, custom entries, compactions, labels (internal)
   */
  private buildConversationNode(piNode: SessionTreeNode): AnnotatedTreeNode | null {
    const entry = piNode.entry;
    const leafId = this.sm.getLeafId();
    const meta = this.getTopicMeta(entry.id);

    // If this node has our custom topic metadata, always show it
    if (meta) {
      return {
        entryId: entry.id,
        parentId: entry.parentId ?? "",
        label: meta.label,
        source: meta.source,
        status: meta.status,
        bookAnchor: meta.bookAnchor,
        messageCount: this.countMessages(piNode),
        isCurrent: entry.id === leafId || this.isOnCurrentPath(piNode, leafId),
        summary: entry.type === "branch_summary" ? (entry as any).summary : undefined,
        children: this.buildConversationTree(piNode.children),
      };
    }

    // User message → show it
    if (entry.type === "message" && (entry as any).message?.role === "user") {
      return {
        entryId: entry.id,
        parentId: entry.parentId ?? "",
        label: this.inferLabel(entry),
        source: "user" as const,
        status: "active" as const,
        messageCount: this.countMessages(piNode),
        isCurrent: entry.id === leafId || this.isOnCurrentPath(piNode, leafId),
        children: this.collectMeaningfulChildren(piNode.children),
      };
    }


    // Assistant message → show it only if it has meaningful text content
    if (entry.type === "message" && (entry as any).message?.role === "assistant") {
      const children = this.collectMeaningfulChildren(piNode.children);
      const hasText = this.hasTextContent(entry);

      // If assistant message has no text (tool-call only), skip it — pass children through
      if (!hasText) {
        if (children.length === 1) return children[0];
        if (children.length > 1) {
          // Rare: tool-call-only message is a branch point — show as generic node
          return {
            entryId: entry.id,
            parentId: entry.parentId ?? "",
            label: "✦ …",
            source: "auto" as const,
            status: "completed" as const,
            messageCount: 0,
            isCurrent: false,
            children,
          };
        }
        return null;
      }

      // Has text — show if it's a leaf, branch point, or on current path
      const isLeaf = piNode.children.length === 0;
      const isBranchPoint = children.length > 1;
      const isOnPath = entry.id === leafId || this.isOnCurrentPath(piNode, leafId);

      if (isLeaf || isBranchPoint || isOnPath) {
        return {
          entryId: entry.id,
          parentId: entry.parentId ?? "",
          label: "✦ " + this.inferAssistantLabel(entry),
          source: "auto" as const,
          status: isLeaf ? "active" as const : "completed" as const,
          messageCount: 0,
          isCurrent: entry.id === leafId,
          children,
        };
      }

      // Single-child assistant → flatten, pass children through
      if (children.length === 1) return children[0];
      return null;
    }

    // For internal entries (tool results, custom, compaction, label, etc.):
    // Don't show this node itself, but propagate its children up
    if (piNode.children.length > 0) {
      const childNodes = this.buildConversationTree(piNode.children);
      if (childNodes.length === 1) return childNodes[0];
      if (childNodes.length > 1) {
        return {
          entryId: entry.id,
          parentId: entry.parentId ?? "",
          label: this.inferLabel(entry),
          source: "auto" as const,
          status: "active" as const,
          messageCount: this.countMessages(piNode),
          isCurrent: false,
          children: childNodes,
        };
      }
    }

    return null;
  }

  /**
   * Collect meaningful child nodes, skipping internal entries.
   */
  private collectMeaningfulChildren(children: SessionTreeNode[]): AnnotatedTreeNode[] {
    const result: AnnotatedTreeNode[] = [];
    for (const child of children) {
      const node = this.buildConversationNode(child);
      if (node) result.push(node);
    }
    return result;
  }

  /**
   * Check if a node is on the path to the current leaf.
   */
  private isOnCurrentPath(node: SessionTreeNode, leafId: string | null): boolean {
    if (!leafId) return false;
    if (node.entry.id === leafId) return true;
    return node.children.some((c) => this.isOnCurrentPath(c, leafId));
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

  /**
   * Build a lookup map: entryId → { role, content } for all message entries.
   * Walks the entire raw tree to find full message content.
   */
  getMessageContentMap(): Map<
    string,
    { role: string; content: string; timestamp: string }
  > {
    const map = new Map<
      string,
      { role: string; content: string; timestamp: string }
    >();
    const piTree = this.sm.getTree();

    const walk = (nodes: SessionTreeNode[]) => {
      for (const node of nodes) {
        const entry = node.entry;
        if (entry.type === "message" && "message" in entry) {
          const msg = (entry as any).message;
          const content = Array.isArray(msg.content)
            ? (msg.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text")
                .map((c) => c.text ?? "")
                .join("")
            : String(msg.content ?? "");
          map.set(entry.id, {
            role: msg.role,
            content,
            timestamp: entry.timestamp,
          });
        }
        walk(node.children);
      }
    };
    walk(piTree);
    return map;
  }

  getSessionFile(): string {
    return this.sm.getSessionFile() ?? "";
  }

  getSessionId(): string {
    return this.sm.getSessionId();
  }

  getSessionName(): string | undefined {
    return this.sm.getSessionName();
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
        return this.extractText(msg.content, 60);
      }
    }
    return `Entry ${entry.id.slice(0, 8)}`;
  }

  private inferAssistantLabel(entry: SessionEntry): string {
    if (entry.type === "message" && "message" in entry) {
      const msg = (entry as any).message;
      const text = this.extractText(msg.content, 50);
      return text || "Response";
    }
    return "Response";
  }

  /**
   * Check if an entry has any text content worth displaying.
   */
  private hasTextContent(entry: SessionEntry): boolean {
    if (entry.type !== "message" || !("message" in entry)) return false;
    const msg = (entry as any).message;
    const rawText = Array.isArray(msg.content)
      ? (msg.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      : String(msg.content ?? "");
    return rawText.trim().length > 0;
  }

  private extractText(content: unknown, maxLen: number): string {
    const text = Array.isArray(content)
      ? (content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("")
      : String(content ?? "");

    // Find the first meaningful line, skipping noise
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const meaningful = lines.find((l) =>
      // Skip system/meta lines
      !l.startsWith("[SYSTEM") &&
      !l.startsWith("---") &&
      !l.startsWith("```") &&
      l.length > 3  // skip tiny lines like "OK" or "..."
    ) ?? lines[0] ?? "";

    // Strip markdown syntax for clean tree labels
    const cleaned = meaningful
      .replace(/^#{1,6}\s+/, "")  // # headers
      .replace(/\*\*([^*]+)\*\*/g, "$1")  // **bold**
      .replace(/\*([^*]+)\*/g, "$1")  // *italic*
      .replace(/`([^`]+)`/g, "$1")  // `code`
      .replace(/^[-*>]\s+/, "")  // list/quote markers
      .replace(/^\[.*?\]\s*/, "")  // [emoji] prefixes
      .trim();
    if (!cleaned) return "";
    return cleaned.slice(0, maxLen) + (cleaned.length > maxLen ? "…" : "");
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
