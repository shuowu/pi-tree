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

    // Auto-resume: if no explicit session given, check the active manifest
    let resumeSession = options?.resumeSession;
    if (!resumeSession) {
      resumeSession = await TreeManager.readActiveSession(
        library.getLibraryPath(),
        bookId,
      );
    }

    const piSession = await PiSession.create(
      bookId,
      library.getLibraryPath(),
      resumeSession ? { resumeSession } : undefined,
    );

    // Persist the active session ID so server restarts resume correctly
    const sessionId = piSession.getSessionId();
    if (sessionId) {
      await TreeManager.writeActiveSession(
        library.getLibraryPath(),
        bookId,
        sessionId,
      );
    }

    // TODO: Load per-book config from BOOK.md
    return new TreeManager(piSession, bookId, library);
  }

  /**
   * Read the active session ID for a book from its manifest file.
   */
  private static async readActiveSession(
    libraryPath: string,
    bookId: string,
  ): Promise<string | undefined> {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const manifestPath = join(libraryPath, bookId, ".sessions", "active.json");

    try {
      const raw = await readFile(manifestPath, "utf-8");
      const data = JSON.parse(raw);
      return data.sessionId ?? undefined;
    } catch {
      return undefined; // No manifest yet — first session for this book
    }
  }

  /**
   * Write the active session ID to the book's manifest file.
   */
  private static async writeActiveSession(
    libraryPath: string,
    bookId: string,
    sessionId: string,
  ): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const sessionDir = join(libraryPath, bookId, ".sessions");

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "active.json"),
      JSON.stringify({ sessionId, updatedAt: new Date().toISOString() }, null, 2) + "\n",
    );
  }

  // ---------------------------------------------------------------------------
  // Core: Handle a user message
  // ---------------------------------------------------------------------------

  async handleMessage(
    message: string,
    viewNodeId?: string | null,
  ): Promise<SessionState & { response: string }> {
    // 1. If user is viewing a specific scope, branch from there
    //    Otherwise, append linearly to the current leaf.
    if (viewNodeId) {
      const tree = this.buildTreeView();
      const lastNodeId = this.findChainLeaf(tree, viewNodeId);
      if (lastNodeId && lastNodeId !== this.piSession.getLeafId()) {
        this.piSession.branchAt(lastNodeId, {
          label: message.slice(0, 50),
          source: "user",
          status: "active",
        });
      }
    }

    // 2. Send message to Pi for AI response
    const { response } = await this.piSession.sendMessage(message);

    // 3. Return state scoped to the branch the user is in
    return {
      ...this.getSessionState(viewNodeId ?? null),
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
    viewNodeId: string | null,
    callbacks: {
      onToken: (token: string) => Promise<void>;
      onTreeUpdate: (update: Record<string, unknown>) => Promise<void>;
      onDone: (result: Record<string, unknown>) => Promise<void>;
    },
  ): Promise<void> {
    // Position-based branching (same as handleMessage)
    if (viewNodeId) {
      const tree = this.buildTreeView();
      const lastNodeId = this.findChainLeaf(tree, viewNodeId);
      if (lastNodeId && lastNodeId !== this.piSession.getLeafId()) {
        this.piSession.branchAt(lastNodeId, {
          label: message.slice(0, 50),
          source: "user",
          status: "active",
        });
      }
    }

    // Stream the response from Pi
    const { response } = await this.piSession.sendMessageStreaming(
      message,
      callbacks.onToken,
    );

    await callbacks.onDone({
      ...this.getSessionState(viewNodeId),
      response,
    });
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
