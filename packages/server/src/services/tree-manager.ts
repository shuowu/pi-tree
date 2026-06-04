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
import {
  findBranchPoint,
  collectScopeMessages,
  buildBreadcrumb,
} from "./tree-nav.js";

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

    // Persist the active session file path so server restarts resume correctly
    const sessionFile = piSession.getSessionFile();
    console.log(`[tree-manager] Session created — file: ${sessionFile}`);
    if (sessionFile) {
      await TreeManager.writeActiveSession(
        library.getLibraryPath(),
        bookId,
        sessionFile,
      );
    }

    // TODO: Load per-book config from BOOK.md
    return new TreeManager(piSession, bookId, library);
  }

  /**
   * Read the active session file path for a book from its manifest.
   */
  private static async readActiveSession(
    libraryPath: string,
    bookId: string,
  ): Promise<string | undefined> {
    const { readFile, readdir, access } = await import("fs/promises");
    const { join } = await import("path");
    const sessionDir = join(libraryPath, bookId, ".sessions");
    const manifestPath = join(sessionDir, "active.json");

    try {
      const raw = await readFile(manifestPath, "utf-8");
      const data = JSON.parse(raw);
      let sessionPath = data.sessionFile ?? data.sessionId;
      if (!sessionPath) return undefined;

      // If it's already a full absolute path and exists, use it
      if (sessionPath.startsWith("/")) {
        try {
          await access(sessionPath);
          console.log(`[tree-manager] Resuming session: ${sessionPath}`);
          return sessionPath;
        } catch {
          console.warn(`[tree-manager] Session file not found: ${sessionPath}`);
          return undefined;
        }
      }

      // Legacy: sessionId is a UUID or stem — find the matching .jsonl file
      const files = await readdir(sessionDir);
      const match = files.find(
        (f) => f.endsWith(".jsonl") && f.includes(sessionPath),
      );
      if (match) {
        const fullPath = join(sessionDir, match);
        console.log(`[tree-manager] Resolved legacy session: ${fullPath}`);
        return fullPath;
      }

      console.warn(`[tree-manager] No session file matches: ${sessionPath}`);
      return undefined;
    } catch {
      return undefined; // No manifest yet — first session for this book
    }
  }

  /**
   * Write the active session file path to the book's manifest.
   */
  private static async writeActiveSession(
    libraryPath: string,
    bookId: string,
    sessionFile: string,
  ): Promise<void> {
    const { writeFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const sessionDir = join(libraryPath, bookId, ".sessions");

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "active.json"),
      JSON.stringify({ sessionFile, updatedAt: new Date().toISOString() }, null, 2) + "\n",
    );
  }

  // ---------------------------------------------------------------------------
  // Core: Handle a user message
  // ---------------------------------------------------------------------------

  async handleMessage(
    message: string,
    viewNodeId?: string | null,
  ): Promise<SessionState & { response: string }> {
    // Branch from the scope's AI node (findBranchPoint stops at the first
    // AI response, so multiple messages from the same scope are siblings).
    if (viewNodeId) {
      const tree = this.buildTreeView();
      const branchId = findBranchPoint(tree, viewNodeId);
      if (branchId) {
        this.piSession.simpleBranch(branchId);
      }
    }

    // Send message to Pi for AI response
    const { response } = await this.piSession.sendMessage(message);

    return {
      ...this.getSessionState(viewNodeId ?? null),
      response,
    };
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
    // Branch from the scope's AI node (findBranchPoint stops at the first
    // AI response, so multiple messages from the same scope are siblings).
    if (viewNodeId) {
      const tree = this.buildTreeView();
      const branchId = findBranchPoint(tree, viewNodeId);
      if (branchId) {
        this.piSession.simpleBranch(branchId);
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
    const contentMap = this.piSession.getMessageContentMap();
    const { messages, branches } = collectScopeMessages(
      tree,
      viewNodeId,
      contentMap,
    );

    const breadcrumb = viewNodeId
      ? buildBreadcrumb(tree, viewNodeId)
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

  // ---------------------------------------------------------------------------
  // Dictionary lookup (ephemeral — does NOT create session entries)
  // ---------------------------------------------------------------------------

  async handleLookup(
    term: string,
    callbacks: {
      onToken: (token: string) => Promise<void>;
      onDone: (definition: string) => Promise<void>;
    },
  ): Promise<void> {
    const prompt = [
      `Define "${term}" concisely in the context of this book.`,
      `If it's a book-specific concept, explain the author's meaning.`,
      `If it's a general term, give a brief dictionary-style definition.`,
      `Keep it to 2-3 sentences. No markdown headers.`,
    ].join(" ");

    // Use the PiSession's ephemeral lookup (doesn't modify session tree)
    const definition = await this.piSession.ephemeralLookup(
      prompt,
      callbacks.onToken,
    );

    await callbacks.onDone(definition);
  }

  // ---------------------------------------------------------------------------
  // Glossary persistence
  // ---------------------------------------------------------------------------

  async saveGlossaryEntry(
    term: string,
    definition?: string,
  ): Promise<void> {
    const { appendFile, mkdir } = await import("fs/promises");
    const { join } = await import("path");

    const notesDir = join(
      this.library.getLibraryPath(),
      this.bookId,
      "notes",
    );
    await mkdir(notesDir, { recursive: true });

    const glossaryPath = join(notesDir, "glossary.md");
    const timestamp = new Date().toISOString().slice(0, 10);
    const entry = definition
      ? `\n- **${term}** — ${definition} _(${timestamp})_\n`
      : `\n- **${term}** _(${timestamp})_\n`;

    await appendFile(glossaryPath, entry);
  }
}
