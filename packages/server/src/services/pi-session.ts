/**
 * PiSession — integration layer between pi-tree and Pi SDK.
 *
 * Pi handles: session storage, tree structure, AI responses, compaction,
 *             tool execution, streaming, context building.
 * We handle:  reading-specific metadata (topic labels, book anchors),
 *             stored as CustomEntry in Pi's session JSONL.
 *
 * Architecture: SDK mode (not RPC) — we need SessionManager's tree API.
 */

import { join } from "node:path";
import type { BookAnchor } from "@pi-tree/shared";
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
import { getServerConfig } from "../config.js";
import { isAbandoned as checkAbandoned } from "./tree-filter.js";
import { shouldShowAssistantNode } from "./conversation-tree.js";

// SessionTreeNode is not exported from the main barrel — define locally
interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
}

// ---------------------------------------------------------------------------
// Custom entry types stored in Pi session
// ---------------------------------------------------------------------------

const CUSTOM_TYPE = "pi-tree";

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

export interface SectionLabelMeta {
  kind: "section_label";
  targetEntryId: string;
  newLabel: string;
}

export type PiTreeData = TopicMeta | SectionStatusMeta | SectionLabelMeta;

// ---------------------------------------------------------------------------
// PiSession
// ---------------------------------------------------------------------------

export class PiSession {
  private topicCache: Map<string, TopicMeta> = new Map();
  private statusOverrides: Map<string, string> = new Map();
  private labelOverrides: Map<string, string> = new Map();
  /** Deferred system context — prepended to the first user message */
  private pendingContext: string | null = null;

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
    userId: string,
    bookId: string,
    libraryPath: string,
    dataPath: string,
    options?: { resumeSession?: string },
  ): Promise<PiSession> {
    // Repo root — where .pi/skills/ lives (pi-tree's own copy)
    const repoRoot = join(import.meta.dirname, "../../../..");

    // Session storage: each user+book gets its own session directory
    const sessionDir = join(dataPath, "sessions", bookId, userId);

    // SessionManager cwd: use repo root so SDK discovers .pi/skills/
    let sm: SessionManager;
    if (options?.resumeSession) {
      sm = SessionManager.open(options.resumeSession, sessionDir);
    } else {
      sm = SessionManager.create(repoRoot, sessionDir);
    }

    // Try to create a full agent session. Falls back to session-only mode
    // if auth is not configured (no API keys).
    let agent: AgentSession | null = null;
    try {
      const serverConfig = getServerConfig();

      // Auth: use in-memory auth (no file I/O) so the server never implicitly
      // reads ~/.pi/agent/auth.json. API keys are set programmatically from env vars.
      const authStorage = AuthStorage.inMemory();
      if (serverConfig.apiKey && serverConfig.provider) {
        authStorage.setRuntimeApiKey(serverConfig.provider, serverConfig.apiKey);
        console.log(`[pi-session] Auth: env var API key layered for provider "${serverConfig.provider}"`);
      }

      // In-memory model registry — loads SDK built-in models but skips ~/.pi/agent/models.json
      const modelRegistry = ModelRegistry.inMemory(authStorage);

      // If env var specifies a custom base URL, register/override that provider.
      // The API type (e.g. "anthropic-messages") must be explicitly configured
      // via PI_API_TYPE env var or the Settings UI — no auto-detection, so
      // behavior is identical between local dev and Docker.
      if (serverConfig.provider && serverConfig.baseUrl) {
        const apiType = serverConfig.api || undefined;

        if (apiType) {
          // When overriding the API type, we must re-register models explicitly.
          // registerProvider without a models array only updates the URL but
          // leaves built-in models' api field unchanged (e.g. "openai-completions").
          const existingModels = modelRegistry
            .getAll()
            .filter((m) => m.provider === serverConfig.provider);

          const modelsConfig = existingModels.map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            api: apiType as any,
            reasoning: m.reasoning ?? false,
            input: (m.input ?? ["text"]) as ("text" | "image")[],
            cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: m.contextWindow ?? 200000,
            maxTokens: m.maxTokens ?? 16384,
          }));

          modelRegistry.registerProvider(serverConfig.provider, {
            baseUrl: serverConfig.baseUrl,
            api: apiType as any,
            apiKey: serverConfig.apiKey,
            models: modelsConfig.length > 0 ? modelsConfig : undefined,
          });
        } else {
          modelRegistry.registerProvider(serverConfig.provider, {
            baseUrl: serverConfig.baseUrl,
          });
        }
        console.log(
          `[pi-session] Provider "${serverConfig.provider}" base URL: ${serverConfig.baseUrl}${apiType ? ` (API: ${apiType})` : ""}`,
        );
      }

      // ResourceLoader: discover .pi/skills/ from pi-tree repo root
      // plus any user-mounted skills/extensions (Docker: DATA_PATH/skills/, DATA_PATH/extensions/)
      const agentDir = getAgentDir();

      // Additional paths for Docker extensibility — users can mount custom
      // skills/extensions at these locations without modifying the image.
      const additionalSkillPaths: string[] = [];
      const additionalExtensionPaths: string[] = [];

      // Extension package's skills directory (always included)
      const extensionPkgSkills = join(import.meta.dirname, "../../../extension/skills");
      additionalSkillPaths.push(extensionPkgSkills);

      // User-configurable paths via env vars or DATA_PATH convention
      const userSkillsPath = process.env.SKILLS_PATH || join(dataPath, "skills");
      const userExtensionsPath = process.env.EXTENSIONS_PATH || join(dataPath, "extensions");
      additionalSkillPaths.push(userSkillsPath);
      additionalExtensionPaths.push(userExtensionsPath);

      const resourceLoader = new DefaultResourceLoader({
        cwd: repoRoot,
        agentDir,
        additionalSkillPaths,
        additionalExtensionPaths,
      });
      await resourceLoader.reload();

      // Model selection
      const modelId = serverConfig.readingModel;
      const allModels = modelRegistry.getAll();
      const selectedModel = allModels.find((m) => m.id === modelId);
      if (selectedModel) {
        console.log(`[pi-session] Using reading model: ${selectedModel.provider}/${selectedModel.id}`);
      } else {
        console.log(`[pi-session] Model "${modelId}" not found, using SDK default. Available: ${allModels.map((m) => `${m.provider}/${m.id}`).join(", ")}`);
      }

      const { session } = await createAgentSession({
        // cwd for tools (read, grep, etc.) — point at library so AI can read books
        cwd: libraryPath,
        tools: ["read", "grep", "find", "ls"], // read-only for book reading
        resourceLoader,
        sessionManager: sm,
        settingsManager: SettingsManager.create(repoRoot),
        authStorage,
        modelRegistry,
        ...(selectedModel ? { model: selectedModel } : {}),
      });

      agent = session;

      // Enable auto-compaction — Pi SDK monitors context tokens after each turn
      // and triggers LLM-powered summarization when nearing the context window.
      // This is append-only: old messages stay in the JSONL, only the LLM's
      // context view is compacted. Tree/chat UI reads raw entries, unaffected.
      agent.setAutoCompactionEnabled(true);
    } catch (err) {
      console.warn(
        `[pi-tree] Could not create agent session (missing API key?): ${err}`,
      );
      console.warn(`[pi-tree] Running in session-only mode (no AI responses)`);
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

      // Defer context injection — will be prepended to the first user message.
      // This keeps startSession() fast so the client can show a welcome screen.
      if (agent) {
        const bookDir = join(libraryPath, bookId);
        piSession.pendingContext = [
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
          `Read the outline from ${bookDir}/analysis/outline.md if it exists`,
          `to understand the book's structure before responding.`,
        ].join("\n");
      }
    }

    return piSession;
  }

  // -------------------------------------------------------------------------
  // Context injection (deferred from create)
  // -------------------------------------------------------------------------

  /**
   * If there's pending system context, prepend it to the message and clear it.
   * Called once on the first user message for a fresh session.
   */
  private consumePendingContext(userMessage: string): string {
    if (!this.pendingContext) return userMessage;
    const combined = `${this.pendingContext}\n\n---\n\n${userMessage}`;
    this.pendingContext = null;
    return combined;
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

    // Prepend deferred context to the first message
    const fullMessage = this.consumePendingContext(message);

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
      await this.agent.prompt(fullMessage);
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
    onTurnEnd?: () => Promise<void>,
    onToolCall?: (info: { toolName: string; args: Record<string, unknown> }) => Promise<void>,
    onCompaction?: (event: { type: "compaction_start" | "compaction_end"; reason: string }) => Promise<void>,
  ): Promise<{ response: string; entryId: string }> {
    if (!this.agent) {
      return this.sendMessageNoAgent(message);
    }

    // Prepend deferred context to the first message
    const fullMessage = this.consumePendingContext(message);

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
          // Reset for the next turn — only keep the final turn's text.
          // This clears preamble like "Let me look that up…" before a tool
          // call so the client only shows the real answer.
          fullResponse = "";
          if (onTurnEnd) await onTurnEnd();
        }
        // Forward tool execution start so the client can show progress
        if (event.type === "tool_execution_start" && onToolCall) {
          await onToolCall({ toolName: event.toolName, args: event.args ?? {} });
        }
        // Forward compaction events so the client can show a status indicator
        if (event.type === "compaction_start" && onCompaction) {
          await onCompaction({ type: "compaction_start", reason: event.reason });
        }
        if (event.type === "compaction_end" && onCompaction) {
          await onCompaction({ type: "compaction_end", reason: event.reason });
        }
      },
    );

    try {
      await this.agent.prompt(fullMessage);
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
   * Uses Pi SDK's LLM-powered compaction — summarizes old messages and
   * replaces them in the LLM's context view while keeping raw entries intact.
   */
  async compact(customInstructions?: string): Promise<string> {
    if (!this.agent) {
      // Session-only mode — no LLM available for summarization
      const summary = customInstructions ?? "Compaction summary (no AI)";
      const leafId = this.sm.getLeafId() ?? "";
      return this.sm.appendCompaction(summary, leafId, 0);
    }

    const result = await this.agent.compact(customInstructions);
    return result.summary;
  }

  /**
   * Check if compaction is currently in progress.
   */
  get isCompacting(): boolean {
    return this.agent?.isCompacting ?? false;
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

    // Skip abandoned nodes (soft-deleted)
    if (this.isAbandoned(entry.id, meta)) {
      return null;
    }

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
        label: this.labelOverrides.get(entry.id) ?? this.inferLabel(entry),
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

      // Has text — use extracted decision logic to determine visibility
      const decision = shouldShowAssistantNode({
        rawChildCount: piNode.children.length,
        meaningfulChildren: children.map(c => ({
          entryId: c.entryId,
          source: c.source,
          label: c.label,
        })),
      });

      if (decision.show) {
        return {
          entryId: entry.id,
          parentId: entry.parentId ?? "",
          label: this.labelOverrides.get(entry.id) ?? ("✦ " + this.inferAssistantLabel(entry)),
          source: "auto" as const,
          status: decision.status ?? "active",
          messageCount: 0,
          isCurrent: entry.id === leafId,
          children,
        };
      }

      // Single-child assistant → flatten, pass children through
      if (decision.flatten && children.length === 1) return children[0];
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
          // Only include user and assistant messages in the content map
          // (skip tool results, system, and other internal roles)
          if (msg.role !== "user" && msg.role !== "assistant") {
            walk(node.children);
            continue;
          }
          let content = Array.isArray(msg.content)
            ? (msg.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text")
                .map((c) => c.text ?? "")
                .join("")
            : String(msg.content ?? "");

          // Strip deferred system context prefix from user messages
          // so it doesn't appear in the chat UI
          if (msg.role === "user" && content.includes("[SYSTEM CONTEXT")) {
            const sepIdx = content.indexOf("\n\n---\n\n");
            if (sepIdx !== -1) {
              content = content.slice(sepIdx + 7); // 7 = "\n\n---\n\n".length
            }
          }

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
    // Save leaf position — appendCustomEntry advances the cursor, which
    // would create a parasitic child node in the conversation tree.
    const savedLeafId = this.sm.getLeafId();

    // Append-only: store a status update entry
    this.sm.appendCustomEntry(CUSTOM_TYPE, {
      kind: "section_status",
      targetEntryId: entryId,
      newStatus: status,
    } satisfies SectionStatusMeta);

    // Restore leaf position so the tree structure is unaffected
    if (savedLeafId) this.sm.branch(savedLeafId);

    // Keep in-memory state in sync so isAbandoned() works immediately
    this.statusOverrides.set(entryId, status);
    const meta = this.topicCache.get(entryId);
    if (meta) {
      meta.status = status;
    }
  }

  updateLabel(entryId: string, newLabel: string): void {
    // Save leaf position — appendCustomEntry advances the cursor, which
    // would create a parasitic child node in the conversation tree.
    const savedLeafId = this.sm.getLeafId();

    this.sm.appendCustomEntry(CUSTOM_TYPE, {
      kind: "section_label",
      targetEntryId: entryId,
      newLabel,
    } satisfies SectionLabelMeta);

    // Restore leaf position so the tree structure is unaffected
    if (savedLeafId) this.sm.branch(savedLeafId);

    // Keep in-memory state in sync
    this.labelOverrides.set(entryId, newLabel);
    const meta = this.topicCache.get(entryId);
    if (meta) {
      meta.label = newLabel;
    }
  }

  private rebuildTopicCache(): void {
    this.topicCache.clear();
    this.statusOverrides.clear();
    this.labelOverrides.clear();

    for (const entry of this.sm.getEntries()) {
      if (entry.type !== "custom") continue;
      const custom = entry as CustomEntry;
      if (custom.customType !== CUSTOM_TYPE && custom.customType !== "pi-reader") continue;

      const data = custom.data as PiTreeData;
      if (data.kind === "topic_node") {
        this.topicCache.set(entry.id, data);
      } else if (data.kind === "section_status") {
        this.statusOverrides.set(data.targetEntryId, data.newStatus);
      } else if (data.kind === "section_label") {
        this.labelOverrides.set(data.targetEntryId, data.newLabel);
      }
    }

    // Apply status overrides (latest-wins already handled by iteration order)
    for (const [targetId, status] of this.statusOverrides) {
      const meta = this.topicCache.get(targetId);
      if (meta) {
        meta.status = status as TopicMeta["status"];
      }
    }

    // Apply label overrides
    for (const [targetId, label] of this.labelOverrides) {
      const meta = this.topicCache.get(targetId);
      if (meta) {
        meta.label = label;
      }
    }
  }

  /**
   * Check if an entry has been abandoned (soft-deleted).
   * Checks both topic metadata and standalone status overrides.
   */
  private isAbandoned(entryId: string, meta: TopicMeta | null): boolean {
    return checkAbandoned(entryId, meta, this.statusOverrides);
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
