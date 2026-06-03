/**
 * PiSession — thin wrapper around Pi SDK's SessionManager + AgentSession.
 *
 * This is the integration layer between our reading app and Pi.
 * Pi handles: session storage, tree structure, AI responses, compaction,
 *             tool execution, streaming, context building.
 * We handle:  reading-specific metadata (topic labels, book anchors),
 *             intent classification, and mapping outline→tree.
 *
 * Architecture decision: SDK mode (not RPC) because we need SessionManager's
 * tree API (branch, getTree, getPath) which isn't exposed in RPC mode.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { TopicNode, BookAnchor } from "@pi-reader/shared";

// ---------------------------------------------------------------------------
// Types for Pi SDK (will be imported from @earendil-works/pi-coding-agent)
// ---------------------------------------------------------------------------

// These mirror the Pi SDK's actual types. When we install the real package,
// we replace these with direct imports.

interface PiSessionManager {
  readonly sessionId: string;
  readonly filePath: string;

  // Tree
  getEntries(): PiSessionEntry[];
  getTree(): PiTreeNode[];
  getPath(): PiSessionEntry[];
  getLeafEntry(): PiSessionEntry | null;
  getEntry(id: string): PiSessionEntry | null;
  getChildren(id: string): PiSessionEntry[];

  // Branching
  branch(entryId: string): void;
  branchWithSummary(entryId: string, summary: string): void;

  // Appending
  appendMessage(message: PiMessage): string;
  appendCustom(extensionId: string, data: unknown): string;
  appendCompaction(summary: string): string;
  appendBranchSummary(summary: string): string;
  appendLabelChange(targetId: string, label: string): string;

  // Context
  getContextMessages(): PiMessage[];
  getLabel(id: string): string | null;
}

interface PiSessionEntry {
  type: string;
  id: string;
  parentId: string;
  timestamp: string;
  // Message entries have a message field
  message?: PiMessage;
  // Custom entries have extensionId + data
  extensionId?: string;
  data?: unknown;
  // Compaction/branch summary entries have summary
  summary?: string;
}

interface PiTreeNode {
  entry: PiSessionEntry;
  children: PiTreeNode[];
}

interface PiMessage {
  role: "user" | "assistant" | "tool_result";
  content: Array<{ type: "text"; text: string }>;
}

interface PiAgentSession {
  prompt(message: string): Promise<void>;
  subscribe(callback: (event: PiEvent) => void): () => void;
}

interface PiEvent {
  type: string;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
    text?: string;
  };
}

// ---------------------------------------------------------------------------
// Topic metadata stored as CustomEntry in Pi session
// ---------------------------------------------------------------------------

const EXTENSION_ID = "pi-reader";

interface TopicMeta {
  kind: "topic_node";
  label: string;
  source: "outline" | "user" | "auto";
  bookAnchor?: BookAnchor;
  status: "active" | "completed" | "abandoned";
}

// ---------------------------------------------------------------------------
// PiSession — the integration layer
// ---------------------------------------------------------------------------

export class PiSession {
  private topicIndex: Map<string, TopicMeta> = new Map(); // entryId → metadata

  constructor(
    private sessionManager: PiSessionManager,
    private agentSession: PiAgentSession | null, // null until Pi SDK is installed
    private bookId: string,
    private libraryPath: string,
  ) {}

  // -------------------------------------------------------------------------
  // Factory — create or load a session for a book
  // -------------------------------------------------------------------------

  static async create(
    bookId: string,
    libraryPath: string,
    options?: { resumeSession?: string },
  ): Promise<PiSession> {
    // -----------------------------------------------------------------------
    // Pi SDK integration (uncomment when @earendil-works/pi-coding-agent is installed)
    // -----------------------------------------------------------------------
    //
    // import {
    //   createAgentSession,
    //   DefaultResourceLoader,
    //   SessionManager,
    //   SettingsManager,
    //   AuthStorage,
    //   ModelRegistry,
    //   createReadOnlyTools,
    // } from "@earendil-works/pi-coding-agent";
    //
    // const piBooksCwd = join(libraryPath, "..");  // pi-books project root
    // const bookDir = join(libraryPath, bookId);
    // const sessionDir = join(bookDir, ".sessions");
    //
    // const authStorage = AuthStorage.create();
    // const modelRegistry = ModelRegistry.create(authStorage);
    //
    // // ResourceLoader auto-discovers .pi/skills/ and .pi/extensions/
    // // from piBooksCwd — this loads interactive-reading, book-outline, etc.
    // const resourceLoader = new DefaultResourceLoader({ cwd: piBooksCwd });
    // await resourceLoader.reload();
    //
    // // Session: resume existing or create new
    // const sm = options?.resumeSession
    //   ? SessionManager.open(options.resumeSession)
    //   : SessionManager.create(sessionDir);
    //
    // const { session } = await createAgentSession({
    //   cwd: piBooksCwd,              // Pi's cwd = pi-books root (for skills + library access)
    //   tools: createReadOnlyTools(piBooksCwd),  // safe read-only for book reading
    //   resourceLoader,               // auto-loads all 11 skills + ebook-converter extension
    //   sessionManager: sm,
    //   settingsManager: SettingsManager.inMemory({
    //     compaction: { enabled: true },
    //   }),
    //   authStorage,
    //   modelRegistry,
    // });
    //
    // // Subscribe to streaming events
    // session.subscribe((event) => {
    //   // Events forwarded to client via SSE in the route handler
    // });
    //
    // return new PiSession(sm, session, bookId, libraryPath);
    // -----------------------------------------------------------------------

    // Mock implementation for development
    const mockSM = PiSession.createMockSessionManager(bookId);
    const piSession = new PiSession(mockSM, null, bookId, libraryPath);

    piSession.registerTopicNode(mockSM.getLeafEntry()!.id, {
      kind: "topic_node",
      label: bookId,
      source: "auto",
      status: "active",
    });

    return piSession;
  }

  // -------------------------------------------------------------------------
  // Core: Send message to Pi, get response
  // -------------------------------------------------------------------------

  async sendMessage(message: string): Promise<{
    response: string;
    entryId: string;
  }> {
    // With real Pi SDK:
    // await this.agentSession.prompt(message);
    // The response comes via subscribe() events
    // We capture the assistant message and its entry ID

    // For now: mock
    const userEntryId = this.sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: message }],
    });

    const response = `[Pi SDK pending] Response to: "${message}" in context of book "${this.bookId}"`;
    const assistantEntryId = this.sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: response }],
    });

    return { response, entryId: assistantEntryId };
  }

  async sendMessageStreaming(
    message: string,
    onToken: (token: string) => Promise<void>,
  ): Promise<{ response: string; entryId: string }> {
    // With real Pi SDK:
    // const unsubscribe = this.agentSession.subscribe(async (event) => {
    //   if (event.type === 'message_update' &&
    //       event.assistantMessageEvent?.type === 'text_delta') {
    //     await onToken(event.assistantMessageEvent.delta!);
    //   }
    // });
    // await this.agentSession.prompt(message);
    // unsubscribe();

    return this.sendMessage(message);
  }

  // -------------------------------------------------------------------------
  // Tree operations — delegate to Pi's SessionManager
  // -------------------------------------------------------------------------

  /**
   * Branch from a specific entry to start a new topic.
   * Returns the entry ID that is now the active leaf.
   */
  branchAt(entryId: string, meta: Omit<TopicMeta, "kind">): string {
    this.sessionManager.branch(entryId);

    // Store topic metadata as a custom entry in the Pi session
    const customId = this.sessionManager.appendCustom(EXTENSION_ID, {
      ...meta,
      kind: "topic_node" as const,
    });
    this.topicIndex.set(customId, { ...meta, kind: "topic_node" });

    // Label the branch point for easy navigation
    this.sessionManager.appendLabelChange(customId, meta.label);

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
    this.sessionManager.branchWithSummary(targetEntryId, summary);

    if (meta) {
      const customId = this.sessionManager.appendCustom(EXTENSION_ID, {
        ...meta,
        kind: "topic_node" as const,
      });
      this.topicIndex.set(customId, { ...meta, kind: "topic_node" });
      return customId;
    }

    return targetEntryId;
  }

  /**
   * Compact the current branch (Pi handles the summarization).
   */
  async compact(customInstructions?: string): Promise<string> {
    // With real Pi SDK via RPC or direct:
    // await this.agentSession.compact(customInstructions);
    const summary = `Compaction summary for current context`;
    return this.sessionManager.appendCompaction(summary);
  }

  // -------------------------------------------------------------------------
  // Tree reading — reconstruct our topic tree from Pi's session tree
  // -------------------------------------------------------------------------

  /**
   * Get the full tree, annotated with our topic metadata.
   * Pi's tree is the source of truth; we overlay our metadata.
   */
  getAnnotatedTree(): AnnotatedTreeNode[] {
    const piTree = this.sessionManager.getTree();
    return piTree.map((node) => this.annotateNode(node));
  }

  /**
   * Get the path from root to current position (breadcrumb).
   */
  getBreadcrumb(): Array<{ entryId: string; label: string }> {
    const path = this.sessionManager.getPath();
    const crumbs: Array<{ entryId: string; label: string }> = [];

    for (const entry of path) {
      // Check if this entry has topic metadata
      const meta = this.getTopicMeta(entry.id);
      if (meta) {
        crumbs.push({ entryId: entry.id, label: meta.label });
      }
    }

    return crumbs;
  }

  /**
   * Get messages on the current branch path.
   */
  getCurrentMessages(): Array<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
  }> {
    const path = this.sessionManager.getPath();
    return path
      .filter((e) => e.type === "message" && e.message)
      .map((e) => ({
        id: e.id,
        role: e.message!.role,
        content: e.message!.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join(""),
        timestamp: e.timestamp,
      }));
  }

  /**
   * Get the session file path — useful for resuming later.
   */
  getSessionFile(): string {
    return this.sessionManager.filePath;
  }

  getSessionId(): string {
    return this.sessionManager.sessionId;
  }

  // -------------------------------------------------------------------------
  // Metadata management
  // -------------------------------------------------------------------------

  private registerTopicNode(entryId: string, meta: TopicMeta): void {
    this.topicIndex.set(entryId, meta);
  }

  private getTopicMeta(entryId: string): TopicMeta | null {
    // Check in-memory index first
    if (this.topicIndex.has(entryId)) {
      return this.topicIndex.get(entryId)!;
    }

    // Check if the entry itself is a custom entry with our metadata
    const entry = this.sessionManager.getEntry(entryId);
    if (
      entry?.type === "custom" &&
      entry.extensionId === EXTENSION_ID &&
      (entry.data as TopicMeta)?.kind === "topic_node"
    ) {
      const meta = entry.data as TopicMeta;
      this.topicIndex.set(entryId, meta);
      return meta;
    }

    // Check labels as fallback
    const label = this.sessionManager.getLabel(entryId);
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

  private annotateNode(piNode: PiTreeNode): AnnotatedTreeNode {
    const meta = this.getTopicMeta(piNode.entry.id);
    const leaf = this.sessionManager.getLeafEntry();
    const messageCount = this.countMessages(piNode);

    return {
      entryId: piNode.entry.id,
      parentId: piNode.entry.parentId,
      label: meta?.label ?? this.inferLabel(piNode.entry),
      source: meta?.source ?? "auto",
      status: meta?.status ?? "active",
      bookAnchor: meta?.bookAnchor,
      messageCount,
      isCurrent: piNode.entry.id === leaf?.id,
      summary: piNode.entry.summary,
      children: piNode.children.map((c) => this.annotateNode(c)),
    };
  }

  private inferLabel(entry: PiSessionEntry): string {
    if (entry.message?.role === "user") {
      const text = entry.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      return text.slice(0, 60) + (text.length > 60 ? "…" : "");
    }
    return `Entry ${entry.id.slice(0, 8)}`;
  }

  private countMessages(node: PiTreeNode): number {
    let count = 0;
    if (node.entry.type === "message" && node.entry.message?.role === "user") {
      count++;
    }
    for (const child of node.children) {
      count += this.countMessages(child);
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Mock SessionManager (until Pi SDK is installed)
  // -------------------------------------------------------------------------

  private static createMockSessionManager(
    bookId: string,
  ): PiSessionManager {
    const entries: PiSessionEntry[] = [];
    let currentLeafId: string | null = null;
    const labels: Map<string, string> = new Map();

    const rootId = randomUUID();
    const rootEntry: PiSessionEntry = {
      type: "message",
      id: rootId,
      parentId: "root",
      timestamp: new Date().toISOString(),
      message: {
        role: "user",
        content: [{ type: "text", text: `Open book: ${bookId}` }],
      },
    };
    entries.push(rootEntry);
    currentLeafId = rootId;

    const sm: PiSessionManager = {
      sessionId: randomUUID(),
      filePath: `/mock/sessions/${bookId}.jsonl`,

      getEntries: () => [...entries],
      getTree: () => {
        // Build tree from flat entries
        const nodeMap = new Map<string, PiTreeNode>();
        for (const e of entries) {
          nodeMap.set(e.id, { entry: e, children: [] });
        }
        const roots: PiTreeNode[] = [];
        for (const e of entries) {
          const node = nodeMap.get(e.id)!;
          if (e.parentId === "root") {
            roots.push(node);
          } else {
            nodeMap.get(e.parentId)?.children.push(node);
          }
        }
        return roots;
      },
      getPath: () => {
        // Walk from root to leaf
        if (!currentLeafId) return [];
        const path: PiSessionEntry[] = [];
        let id: string | null = currentLeafId;
        while (id && id !== "root") {
          const entry = entries.find((e) => e.id === id);
          if (!entry) break;
          path.unshift(entry);
          id = entry.parentId;
        }
        return path;
      },
      getLeafEntry: () =>
        currentLeafId
          ? entries.find((e) => e.id === currentLeafId) ?? null
          : null,
      getEntry: (id) => entries.find((e) => e.id === id) ?? null,
      getChildren: (id) => entries.filter((e) => e.parentId === id),

      branch: (entryId) => {
        currentLeafId = entryId;
      },
      branchWithSummary: (entryId, summary) => {
        const summaryId = randomUUID();
        entries.push({
          type: "branch_summary",
          id: summaryId,
          parentId: entryId,
          timestamp: new Date().toISOString(),
          summary,
        });
        currentLeafId = summaryId;
      },

      appendMessage: (message) => {
        const id = randomUUID();
        entries.push({
          type: "message",
          id,
          parentId: currentLeafId ?? "root",
          timestamp: new Date().toISOString(),
          message,
        });
        currentLeafId = id;
        return id;
      },
      appendCustom: (extensionId, data) => {
        const id = randomUUID();
        entries.push({
          type: "custom",
          id,
          parentId: currentLeafId ?? "root",
          timestamp: new Date().toISOString(),
          extensionId,
          data,
        });
        currentLeafId = id;
        return id;
      },
      appendCompaction: (summary) => {
        const id = randomUUID();
        entries.push({
          type: "compaction",
          id,
          parentId: currentLeafId ?? "root",
          timestamp: new Date().toISOString(),
          summary,
        });
        currentLeafId = id;
        return id;
      },
      appendBranchSummary: (summary) => {
        const id = randomUUID();
        entries.push({
          type: "branch_summary",
          id,
          parentId: currentLeafId ?? "root",
          timestamp: new Date().toISOString(),
          summary,
        });
        currentLeafId = id;
        return id;
      },
      appendLabelChange: (targetId, label) => {
        labels.set(targetId, label);
        const id = randomUUID();
        entries.push({
          type: "label",
          id,
          parentId: currentLeafId ?? "root",
          timestamp: new Date().toISOString(),
        });
        return id;
      },

      getContextMessages: () => {
        return sm
          .getPath()
          .filter((e) => e.type === "message" && e.message)
          .map((e) => e.message!);
      },
      getLabel: (id) => labels.get(id) ?? null,
    };

    return sm;
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
