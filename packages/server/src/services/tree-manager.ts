import type {
  TopicNode,
  SessionState,
  TreeNodeView,
  BreadcrumbItem,
  ChatMessage,
  UserIntent,
  ReaderConfig,
  BookAnchor,
} from "@pi-reader/shared";
import { DEFAULT_CONFIG } from "@pi-reader/shared";
import { randomUUID } from "node:crypto";

/**
 * TreeManager — the core engine for tree-structured reading sessions.
 *
 * Responsibilities:
 * 1. Maintain the topic tree for one book
 * 2. Decide when to branch vs continue (intent classification)
 * 3. Manage summaries when zooming out
 * 4. Interface with Pi SDK for AI responses (TODO: integrate)
 *
 * Key principle: conversations flow freely within a node.
 * Branches are only created on semantic shifts (go deeper, next chapter, etc.)
 */
export class TreeManager {
  private nodes: Map<string, TopicNode> = new Map();
  private activeNodeId: string;
  private messages: Map<string, ChatMessage[]> = new Map(); // nodeId → messages
  private config: ReaderConfig;

  private constructor(
    private bookId: string,
    rootNode: TopicNode,
    config?: Partial<ReaderConfig>,
  ) {
    this.nodes.set(rootNode.id, rootNode);
    this.activeNodeId = rootNode.id;
    this.messages.set(rootNode.id, []);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  static async loadOrCreate(bookId: string): Promise<TreeManager> {
    // TODO: Load from persistent storage (Pi session file or DB)
    // For now, create a fresh session
    const rootNode: TopicNode = {
      id: randomUUID(),
      parentId: null,
      label: bookId, // Will be replaced with actual book title
      source: "auto",
      status: "active",
      messageCount: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    return new TreeManager(bookId, rootNode);
  }

  // ---------------------------------------------------------------------------
  // Core: Handle a user message
  // ---------------------------------------------------------------------------

  async handleMessage(
    message: string,
  ): Promise<SessionState & { response: string }> {
    // 1. Classify intent
    const intent = await this.classifyIntent(message);

    // 2. Execute tree operation based on intent
    switch (intent.type) {
      case "continue":
        // No tree operation — just append to current node
        break;

      case "go_deeper":
        await this.createChildNode(intent.topic);
        break;

      case "next_chapter":
        if (this.config.summary.autoOnChapterChange) {
          await this.summarizeCurrentNode();
        }
        await this.createSiblingChapterNode(intent.chapterLabel);
        break;

      case "zoom_out":
        if (this.config.summary.autoOnZoomOut) {
          await this.summarizeAndZoomOut(intent.targetLevel);
        } else {
          this.navigateToParent();
        }
        break;

      case "lateral_move":
        if (this.config.summary.autoOnChapterChange) {
          await this.summarizeCurrentNode();
        }
        await this.navigateToSibling(intent.target);
        break;

      case "cross_book":
        await this.createChildNode(
          `Cross-ref: ${intent.otherBook} — ${intent.topic}`,
        );
        break;

      case "toc_navigate":
        await this.navigateToOutlineEntry(intent.outlineEntry.line);
        break;
    }

    // 3. Add user message to current node
    const userMsg = this.addMessage("user", message);

    // 4. Get AI response (TODO: integrate Pi SDK)
    const response = await this.getAIResponse(message);
    const assistantMsg = this.addMessage("assistant", response);

    // 5. Return updated state
    return {
      ...this.getSessionState(),
      response,
    };
  }

  async handleMessageStreaming(
    message: string,
    callbacks: {
      onToken: (token: string) => Promise<void>;
      onTreeUpdate: (update: Record<string, unknown>) => Promise<void>;
      onDone: (result: Record<string, unknown>) => Promise<void>;
    },
  ): Promise<void> {
    // TODO: Streaming implementation with Pi SDK
    // For now, fall back to non-streaming
    const result = await this.handleMessage(message);
    await callbacks.onDone(result as unknown as Record<string, unknown>);
  }

  // ---------------------------------------------------------------------------
  // Intent Classification
  // ---------------------------------------------------------------------------

  private async classifyIntent(message: string): Promise<UserIntent> {
    const lower = message.toLowerCase().trim();

    // Heuristic classification — fast, no LLM call needed for clear signals
    // TODO: Fall back to lightweight LLM classification for ambiguous cases

    // Zoom out signals
    if (
      lower.match(
        /^(go back|zoom out|pull back|return|back to (the )?(chapter|book|overview))/,
      )
    ) {
      const targetLevel = lower.includes("book") || lower.includes("overview")
        ? "root"
        : "parent";
      return { type: "zoom_out", targetLevel };
    }

    // Go deeper signals
    if (
      lower.match(
        /^(deep dive|go deeper|explore|dig into|unpack|let me explore)/,
      )
    ) {
      const topic = message.replace(
        /^(deep dive into|go deeper on|explore|dig into|unpack|let me explore)\s*/i,
        "",
      );
      return { type: "go_deeper", topic: topic || "this topic" };
    }

    // Next chapter signals
    if (lower.match(/^(next chapter|continue|move on|next section)/)) {
      return { type: "next_chapter" };
    }

    // Lateral move signals (mentions a specific chapter)
    const chapterMatch = lower.match(
      /(?:go to|jump to|skip to|let me (?:read|look at))\s+(?:chapter|ch\.?)\s*(\d+)/i,
    );
    if (chapterMatch) {
      return {
        type: "lateral_move",
        target: `Chapter ${chapterMatch[1]}`,
      };
    }

    // Cross-book signals
    const crossBookMatch = lower.match(
      /what does (.+?) say|compare (?:this )?with (.+?)(?:'s)?|how does (.+?) (?:think|approach|handle)/i,
    );
    if (crossBookMatch) {
      const otherBook = crossBookMatch[1] ?? crossBookMatch[2] ?? crossBookMatch[3] ?? "other book";
      return {
        type: "cross_book",
        otherBook: otherBook.trim(),
        topic: message,
      };
    }

    // Default: continue the conversation on the current node
    return { type: "continue" };
  }

  // ---------------------------------------------------------------------------
  // Tree Operations
  // ---------------------------------------------------------------------------

  private async createChildNode(
    label: string,
    bookAnchor?: BookAnchor,
  ): Promise<TopicNode> {
    const node: TopicNode = {
      id: randomUUID(),
      parentId: this.activeNodeId,
      label,
      source: "user",
      bookAnchor,
      status: "active",
      messageCount: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    this.nodes.set(node.id, node);
    this.messages.set(node.id, []);
    this.activeNodeId = node.id;
    return node;
  }

  private async createSiblingChapterNode(
    label?: string,
  ): Promise<TopicNode> {
    // Find the parent (part or book level) to create the sibling under
    const current = this.nodes.get(this.activeNodeId)!;
    const parentId = current.parentId;

    // Mark current node as completed
    current.status = "completed";
    current.lastActiveAt = new Date().toISOString();

    const node: TopicNode = {
      id: randomUUID(),
      parentId,
      label: label ?? "Next chapter",
      source: "auto",
      status: "active",
      messageCount: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    this.nodes.set(node.id, node);
    this.messages.set(node.id, []);
    this.activeNodeId = node.id;
    return node;
  }

  private async summarizeCurrentNode(): Promise<string> {
    const current = this.nodes.get(this.activeNodeId)!;
    const msgs = this.messages.get(this.activeNodeId) ?? [];

    // TODO: Use Pi SDK / LLM to generate summary based on config
    const summary = `Summary of "${current.label}" (${msgs.length} exchanges)`;

    current.summary = summary;
    current.status = "completed";
    current.lastActiveAt = new Date().toISOString();
    return summary;
  }

  private async summarizeAndZoomOut(targetLevel?: string): Promise<void> {
    await this.summarizeCurrentNode();

    if (targetLevel === "root") {
      // Zoom all the way to root, summarizing intermediate nodes
      let nodeId = this.activeNodeId;
      while (true) {
        const node = this.nodes.get(nodeId)!;
        if (!node.parentId) break;
        nodeId = node.parentId;
        // Summarize intermediate if not already summarized
        const intermediate = this.nodes.get(nodeId)!;
        if (!intermediate.summary && intermediate.status !== "active") {
          intermediate.summary = `Summary of "${intermediate.label}"`;
          intermediate.status = "completed";
        }
      }
      this.activeNodeId = nodeId;
    } else {
      this.navigateToParent();
    }
  }

  private navigateToParent(): void {
    const current = this.nodes.get(this.activeNodeId)!;
    if (current.parentId) {
      this.activeNodeId = current.parentId;
      const parent = this.nodes.get(this.activeNodeId)!;
      parent.status = "active";
      parent.lastActiveAt = new Date().toISOString();
    }
  }

  private async navigateToSibling(label: string): Promise<void> {
    // Find or create a sibling node with this label
    const current = this.nodes.get(this.activeNodeId)!;
    current.status = "completed";

    const parentId = current.parentId;

    // Check if a node with this label already exists under the parent
    const existing = Array.from(this.nodes.values()).find(
      (n) =>
        n.parentId === parentId &&
        n.label.toLowerCase().includes(label.toLowerCase()),
    );

    if (existing) {
      this.activeNodeId = existing.id;
      existing.status = "active";
      existing.lastActiveAt = new Date().toISOString();
    } else {
      await this.createSiblingChapterNode(label);
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation (from TOC or tree panel clicks)
  // ---------------------------------------------------------------------------

  async navigateTo(
    targetNodeId: string,
    options: { summarize?: boolean } = {},
  ): Promise<SessionState> {
    if (options.summarize && this.activeNodeId !== targetNodeId) {
      await this.summarizeCurrentNode();
    }

    const targetNode = this.nodes.get(targetNodeId);
    if (!targetNode) throw new Error(`Node ${targetNodeId} not found`);

    this.activeNodeId = targetNodeId;
    targetNode.status = "active";
    targetNode.lastActiveAt = new Date().toISOString();

    return this.getSessionState();
  }

  async navigateToOutlineEntry(lineNumber: number): Promise<SessionState> {
    // Find existing node anchored to this line, or create one
    const existing = Array.from(this.nodes.values()).find(
      (n) =>
        n.bookAnchor &&
        n.bookAnchor.lineRange[0] <= lineNumber &&
        n.bookAnchor.lineRange[1] >= lineNumber,
    );

    if (existing) {
      return this.navigateTo(existing.id);
    }

    // Create a new node anchored to this outline entry
    // TODO: Look up the outline to get heading text and line range
    const node = await this.createChildNode(`Section at L${lineNumber}`, {
      lineRange: [lineNumber, lineNumber + 100], // placeholder
    });
    node.source = "outline";

    return this.getSessionState();
  }

  // ---------------------------------------------------------------------------
  // State Getters (for API responses)
  // ---------------------------------------------------------------------------

  getSessionState(): SessionState {
    return {
      bookId: this.bookId,
      activeNodeId: this.activeNodeId,
      breadcrumb: this.getBreadcrumb(),
      messages: this.messages.get(this.activeNodeId) ?? [],
      tree: this.getTreeView(),
    };
  }

  getBreadcrumb(): BreadcrumbItem[] {
    const path: BreadcrumbItem[] = [];
    let nodeId: string | null = this.activeNodeId;

    while (nodeId) {
      const node = this.nodes.get(nodeId);
      if (!node) break;
      path.unshift({ nodeId: node.id, label: node.label });
      nodeId = node.parentId;
    }

    return path;
  }

  getTreeView(): TreeNodeView {
    // Find root
    const root = Array.from(this.nodes.values()).find(
      (n) => n.parentId === null,
    );
    if (!root) throw new Error("No root node found");
    return this.buildTreeView(root);
  }

  private buildTreeView(node: TopicNode): TreeNodeView {
    const children = Array.from(this.nodes.values())
      .filter((n) => n.parentId === node.id)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
      .map((child) => this.buildTreeView(child));

    return {
      id: node.id,
      parentId: node.parentId,
      label: node.label,
      status: node.status,
      messageCount: node.messageCount,
      summary: node.summary,
      children,
      isCurrent: node.id === this.activeNodeId,
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private addMessage(role: "user" | "assistant", content: string): ChatMessage {
    const msg: ChatMessage = {
      id: randomUUID(),
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    const nodeMessages = this.messages.get(this.activeNodeId) ?? [];
    nodeMessages.push(msg);
    this.messages.set(this.activeNodeId, nodeMessages);

    // Update node metadata
    const node = this.nodes.get(this.activeNodeId)!;
    if (role === "user") node.messageCount++;
    node.lastActiveAt = new Date().toISOString();

    return msg;
  }

  private async getAIResponse(userMessage: string): Promise<string> {
    // TODO: Integrate Pi SDK here
    // For now, return a placeholder
    const node = this.nodes.get(this.activeNodeId)!;
    return `[Pi SDK placeholder] Responding to "${userMessage}" in context of "${node.label}". Pi SDK integration pending.`;
  }
}
