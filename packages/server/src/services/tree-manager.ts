/**
 * TreeManager — orchestrates reading sessions.
 *
 * This is now a thin layer that:
 * 1. Classifies user intent (branch vs continue)
 * 2. Delegates tree operations to PiSession (which wraps Pi SDK)
 * 3. Manages reading-specific metadata (topic labels, book anchors)
 *
 * Pi SDK handles: session storage, tree structure, AI responses,
 * compaction, streaming, context building.
 */

import type {
  SessionState,
  TreeNodeView,
  BreadcrumbItem,
  ChatMessage,
  UserIntent,
  ReaderConfig,
} from "@pi-reader/shared";
import { DEFAULT_CONFIG } from "@pi-reader/shared";
import { PiSession, type AnnotatedTreeNode } from "./pi-session.js";
import { LibraryService } from "./library.js";

export class TreeManager {
  private config: ReaderConfig;

  private constructor(
    private piSession: PiSession,
    private bookId: string,
    private library: LibraryService,
    config?: Partial<ReaderConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  static async loadOrCreate(
    bookId: string,
    options?: { resumeSession?: string },
  ): Promise<TreeManager> {
    const library = new LibraryService();
    const piSession = await PiSession.create(
      bookId,
      library.getLibraryPath(),
      options,
    );

    // TODO: Load per-book config from BOOK.md
    return new TreeManager(piSession, bookId, library);
  }

  // ---------------------------------------------------------------------------
  // Core: Handle a user message
  // ---------------------------------------------------------------------------

  async handleMessage(
    message: string,
    viewNodeId?: string | null,
  ): Promise<SessionState & { response: string }> {
    // 1. If user is viewing a specific scope, branch from there
    if (viewNodeId) {
      // Find the last node in the linear chain from viewNodeId
      const tree = this.buildTreeView();
      const lastNodeId = this.findChainLeaf(tree, viewNodeId);
      if (lastNodeId && lastNodeId !== this.piSession.getLeafId()) {
        // Branch from that position
        this.piSession.branchAt(lastNodeId, {
          label: message.slice(0, 50),
          source: "user",
          status: "active",
        });
      }
    }

    // 2. Classify intent
    const intent = await this.classifyIntent(message);

    // 3. Execute tree operation if needed (via PiSession → Pi SDK)
    await this.executeTreeOp(intent, message);

    // 4. Send message to Pi for AI response
    const { response } = await this.piSession.sendMessage(message);

    // 5. Return updated state (scoped to where the new message landed)
    return {
      ...this.getSessionState(null),
      response,
    };
  }

  /**
   * Find the leaf of a linear chain starting from a node.
   * Walks single-child paths to find the last node before a fork or end.
   */
  private findChainLeaf(tree: TreeNodeView, nodeId: string): string | null {
    const node = this.findNode(tree, nodeId);
    if (!node) return null;

    let current = node;
    while (current.children?.length === 1) {
      current = current.children[0];
    }
    return current.id;
  }

  async handleMessageStreaming(
    message: string,
    callbacks: {
      onToken: (token: string) => Promise<void>;
      onTreeUpdate: (update: Record<string, unknown>) => Promise<void>;
      onDone: (result: Record<string, unknown>) => Promise<void>;
    },
  ): Promise<void> {
    const intent = await this.classifyIntent(message);

    // If there's a tree operation, notify the client
    if (intent.type !== "continue") {
      await callbacks.onTreeUpdate({
        operation: intent.type,
        detail: intent,
      });
    }

    await this.executeTreeOp(intent, message);

    // Stream the response from Pi
    const { response } = await this.piSession.sendMessageStreaming(
      message,
      callbacks.onToken,
    );

    await callbacks.onDone({
      ...this.getSessionState(),
      response,
    });
  }

  // ---------------------------------------------------------------------------
  // Intent Classification — decides branch vs continue
  // ---------------------------------------------------------------------------

  private async classifyIntent(message: string): Promise<UserIntent> {
    const lower = message.toLowerCase().trim();

    // ── Zoom out ──
    if (
      lower.match(
        /^(go back|zoom out|pull back|return to|back to (the )?(chapter|book|overview|part))/,
      )
    ) {
      const targetLevel =
        lower.includes("book") || lower.includes("overview")
          ? "root"
          : "parent";
      return { type: "zoom_out", targetLevel };
    }

    // ── Go deeper ──
    if (
      lower.match(
        /^(deep dive|go deeper|explore|dig into|unpack|let me explore)/,
      )
    ) {
      const topic = message
        .replace(
          /^(deep dive into|go deeper on|explore|dig into|unpack|let me explore)\s*/i,
          "",
        )
        .trim();
      return { type: "go_deeper", topic: topic || "this topic" };
    }

    // ── Next chapter ──
    if (lower.match(/^(next chapter|continue reading|move on|next section)/)) {
      return { type: "next_chapter" };
    }

    // ── Lateral move (specific chapter) ──
    const chapterMatch = lower.match(
      /(?:go to|jump to|skip to|let me (?:read|look at))\s+(?:chapter|ch\.?)\s*(\d+)/i,
    );
    if (chapterMatch) {
      return { type: "lateral_move", target: `Chapter ${chapterMatch[1]}` };
    }

    // ── Cross-book ──
    const crossBookMatch = lower.match(
      /what does (.+?) say|compare (?:this )?with (.+?)(?:'s)?|how does (.+?) (?:think|approach|handle)/i,
    );
    if (crossBookMatch) {
      const otherBook = (
        crossBookMatch[1] ??
        crossBookMatch[2] ??
        crossBookMatch[3] ??
        "other book"
      ).trim();
      return { type: "cross_book", otherBook, topic: message };
    }

    // ── Default: continue on current branch ──
    return { type: "continue" };
  }

  // ---------------------------------------------------------------------------
  // Execute tree operations via PiSession
  // ---------------------------------------------------------------------------

  private async executeTreeOp(
    intent: UserIntent,
    _message: string,
  ): Promise<void> {
    switch (intent.type) {
      case "continue":
        // No tree operation — Pi just appends to current branch
        break;

      case "go_deeper": {
        // Branch from current position, create a new topic node
        const leaf = this.piSession.getCurrentMessages();
        const lastMsg = leaf[leaf.length - 1];
        if (lastMsg) {
          this.piSession.branchAt(lastMsg.id, {
            label: intent.topic,
            source: "user",
            status: "active",
          });
        }
        break;
      }

      case "next_chapter": {
        // Summarize current chapter (Pi does the LLM summary)
        if (this.config.summary.autoOnChapterChange) {
          // TODO: Use Pi's compact command with reading-focused instructions
          await this.piSession.compact(
            "Summarize this chapter discussion focusing on key ideas and reader insights",
          );
        }
        // Branch from parent level for the new chapter
        const breadcrumb = this.piSession.getBreadcrumb();
        if (breadcrumb.length >= 2) {
          const parentId = breadcrumb[breadcrumb.length - 2].entryId;
          this.piSession.branchAt(parentId, {
            label: intent.chapterLabel ?? "Next chapter",
            source: "auto",
            status: "active",
          });
        }
        break;
      }

      case "zoom_out": {
        // Summarize current branch and navigate up
        if (this.config.summary.autoOnZoomOut) {
          const breadcrumb = this.piSession.getBreadcrumb();
          const target =
            intent.targetLevel === "root"
              ? breadcrumb[0]
              : breadcrumb[Math.max(0, breadcrumb.length - 2)];

          if (target) {
            this.piSession.branchWithSummary(
              target.entryId,
              "Branch summary placeholder — Pi SDK will generate this",
            );
          }
        }
        break;
      }

      case "lateral_move": {
        // Summarize current, then branch from parent
        if (this.config.summary.autoOnChapterChange) {
          await this.piSession.compact();
        }
        const breadcrumb = this.piSession.getBreadcrumb();
        if (breadcrumb.length >= 2) {
          const parentId = breadcrumb[breadcrumb.length - 2].entryId;
          this.piSession.branchAt(parentId, {
            label: intent.target,
            source: "user",
            status: "active",
          });
        }
        break;
      }

      case "cross_book": {
        // Create a cross-book tangent branch
        const leaf = this.piSession.getCurrentMessages();
        const lastMsg = leaf[leaf.length - 1];
        if (lastMsg) {
          this.piSession.branchAt(lastMsg.id, {
            label: `Cross-ref: ${intent.otherBook}`,
            source: "user",
            status: "active",
          });
        }
        break;
      }

      case "toc_navigate": {
        // Navigate to a specific outline entry
        // This is handled by navigateToOutlineEntry()
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation (from TOC or tree panel clicks)
  // ---------------------------------------------------------------------------

  async navigateTo(
    targetNodeId: string,
    options: { summarize?: boolean } = {},
  ): Promise<SessionState> {
    if (options.summarize) {
      this.piSession.branchWithSummary(
        targetNodeId,
        "Navigation summary — Pi SDK will generate this",
      );
    } else {
      // Direct branch without summary
      this.piSession.branchAt(targetNodeId, {
        label: "Resumed",
        source: "auto",
        status: "active",
      });
    }
    return this.getSessionState();
  }

  async navigateToOutlineEntry(lineNumber: number): Promise<SessionState> {
    const outline = await this.library.getOutline(this.bookId);
    if (!outline) throw new Error("No outline for this book");

    // Find the outline entry closest to this line
    const entry = this.findOutlineEntry(outline.entries, lineNumber);
    const label = entry?.title ?? `Section at L${lineNumber}`;

    // Create a new branch anchored to this book section
    const breadcrumb = this.piSession.getBreadcrumb();
    const rootId = breadcrumb[0]?.entryId;
    if (rootId) {
      this.piSession.branchAt(rootId, {
        label,
        source: "outline",
        status: "active",
        bookAnchor: {
          lineRange: [lineNumber, lineNumber + 100],
          outlineHeading: label,
        },
      });
    }

    return this.getSessionState();
  }

  private findOutlineEntry(
    entries: Array<{ line: number; title: string; children: unknown[] }>,
    line: number,
  ): { line: number; title: string } | null {
    let closest: { line: number; title: string } | null = null;
    for (const entry of entries) {
      if (entry.line <= line) {
        closest = entry;
      }
      const childResult = this.findOutlineEntry(
        entry.children as typeof entries,
        line,
      );
      if (childResult) closest = childResult;
    }
    return closest;
  }

  // ---------------------------------------------------------------------------
  // State getters — transform Pi's tree into our API format
  // ---------------------------------------------------------------------------

  getSessionState(viewNodeId?: string | null): SessionState {
    const tree = this.buildTreeView();
    return this.buildScopedState(tree, viewNodeId ?? null);
  }

  /**
   * Build a scoped session state.
   *
   * Walk the tree from viewNodeId (or root), collecting messages in the
   * linear chain until a fork (node with 2+ children). At the fork,
   * return branch options so the UI can show drill-down indicators.
   */
  private buildScopedState(
    tree: TreeNodeView,
    viewNodeId: string | null,
  ): SessionState {
    // Find the starting node
    const startNode = viewNodeId ? this.findNode(tree, viewNodeId) : tree;
    if (!startNode) {
      return {
        bookId: this.bookId,
        activeNodeId: "",
        viewNodeId,
        breadcrumb: [],
        messages: [],
        tree,
        branches: [],
      };
    }

    // Build a lookup of entryId → full message content from Pi session
    const contentMap = this.piSession.getMessageContentMap();

    // Walk the linear chain from startNode, collecting messages
    const messages: import("@pi-reader/shared").ChatMessage[] = [];
    const branches: import("@pi-reader/shared").BranchOption[] = [];
    this.walkLinearChain(startNode, messages, branches, contentMap);

    // Build breadcrumb: path from root to viewNode
    const breadcrumb = viewNodeId
      ? this.buildBreadcrumbPath(tree, viewNodeId)
      : [];

    return {
      bookId: this.bookId,
      activeNodeId:
        this.piSession.getBreadcrumb().slice(-1)[0]?.entryId ?? "",
      viewNodeId,
      breadcrumb,
      messages,
      tree,
      branches,
    };
  }

  /**
   * Walk a linear chain from a tree node, collecting messages.
   * Stop at forks (2+ children) and populate branches.
   * Uses contentMap for full message text (not truncated tree labels).
   */
  private walkLinearChain(
    node: TreeNodeView,
    messages: import("@pi-reader/shared").ChatMessage[],
    branches: import("@pi-reader/shared").BranchOption[],
    contentMap: Map<string, { role: string; content: string; timestamp: string }>,
  ): void {
    // Look up the actual message content from the Pi session
    const msgData = contentMap.get(node.id);
    if (msgData) {
      messages.push({
        id: node.id,
        role: msgData.role as "user" | "assistant",
        content: msgData.content,
        timestamp: msgData.timestamp,
      });
    }

    if (!node.children || node.children.length === 0) {
      return; // Leaf — done
    }

    if (node.children.length === 1) {
      // Linear chain — keep walking
      this.walkLinearChain(node.children[0], messages, branches, contentMap);
    } else {
      // Fork — stop here and report branches
      for (const child of node.children) {
        branches.push({
          nodeId: child.id,
          label: child.label,
          messageCount: child.messageCount,
          status: child.status,
        });
      }
    }
  }

  /**
   * Build breadcrumb path from root to a target node.
   */
  private buildBreadcrumbPath(
    tree: TreeNodeView,
    targetId: string,
  ): import("@pi-reader/shared").BreadcrumbItem[] {
    const path: import("@pi-reader/shared").BreadcrumbItem[] = [];

    const walk = (node: TreeNodeView): boolean => {
      if (node.id === targetId) {
        path.push({ nodeId: node.id, label: node.label });
        return true;
      }
      for (const child of node.children ?? []) {
        if (walk(child)) {
          path.unshift({ nodeId: node.id, label: node.label });
          return true;
        }
      }
      return false;
    };

    walk(tree);
    return path;
  }

  /**
   * Find a node by id in the tree.
   */
  private findNode(tree: TreeNodeView, id: string): TreeNodeView | null {
    if (tree.id === id) return tree;
    for (const child of tree.children ?? []) {
      const found = this.findNode(child, id);
      if (found) return found;
    }
    return null;
  }

  getTreeView(): TreeNodeView {
    return this.buildTreeView();
  }

  getBreadcrumb(): import("@pi-reader/shared").BreadcrumbItem[] {
    return this.piSession.getBreadcrumb().map((b) => ({
      nodeId: b.entryId,
      label: b.label,
    }));
  }

  private buildTreeView(): TreeNodeView {
    const annotated = this.piSession.getAnnotatedTree();
    if (annotated.length === 0) {
      return {
        id: "",
        parentId: null,
        label: this.bookId,
        status: "active",
        messageCount: 0,
        children: [],
        isCurrent: true,
      };
    }
    return this.annotatedToView(annotated[0]);
  }

  private annotatedToView(node: AnnotatedTreeNode): TreeNodeView {
    return {
      id: node.entryId,
      parentId: node.parentId === "root" ? null : node.parentId,
      label: node.label,
      status: node.status,
      messageCount: node.messageCount,
      summary: node.summary,
      children: node.children.map((c) => this.annotatedToView(c)),
      isCurrent: node.isCurrent,
    };
  }

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  updateConfig(partial: Partial<ReaderConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
      summary: { ...this.config.summary, ...partial.summary },
      compaction: { ...this.config.compaction, ...partial.compaction },
      navigation: { ...this.config.navigation, ...partial.navigation },
    };
  }
}
