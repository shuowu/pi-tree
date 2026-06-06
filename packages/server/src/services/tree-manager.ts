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
} from "@pi-books/shared";
import { DEFAULT_CONFIG } from "@pi-books/shared";
import { eq, and } from "drizzle-orm";
import { getDb, users, userBookSessions, books } from "../db/index.js";
import { PiSession, type AnnotatedTreeNode } from "./pi-session.js";
import { LibraryService } from "./library.js";
import { join } from "node:path";
import os from "node:os";
import {
  findBranchPoint,
  collectScopeMessages,
  buildBreadcrumb,
} from "./tree-nav.js";
import { wrapTokenWithEarlyTreeUpdate } from "./streaming-utils.js";

export class TreeManager {
  private config: ReaderConfig;
  private sessionDbId: number = 0;

  private constructor(
    private piSession: PiSession,
    private userId: string,
    private bookId: string,
    private library: LibraryService,
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  /** Get the DB row ID of the active session */
  getSessionId(): number {
    return this.sessionDbId;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Load an existing tree session or start a new one.
   *
   * @param options.sessionId — When provided, loads the specific session by
   *   DB row ID. When omitted, loads the most recently active session for
   *   the user+book (backward compatible).
   * @param options.resumeSession — Legacy: explicit JSONL file path to resume.
   */
  static async loadOrCreate(
    userId: string,
    bookId: string,
    options?: { sessionId?: number; resumeSession?: string },
  ): Promise<TreeManager> {
    const library = new LibraryService();
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-books");

    // Resolve which session file to resume:
    // 1. Explicit resumeSession path (legacy)
    // 2. sessionId → look up that specific row
    // 3. Most recently active session for user+book
    let resumeSession = options?.resumeSession;
    if (!resumeSession) {
      resumeSession = TreeManager.readActiveSession(userId, bookId, options?.sessionId);
    }

    const db = getDb();
    const bookRow = db.select().from(books).where(eq(books.id, bookId)).get();
    const isUpload = bookRow && bookRow.source !== "library";
    const resolvedLibraryPath = isUpload
      ? join(dataPath, "books")
      : library.getLibraryPath();

    const piSession = await PiSession.create(
      userId,
      bookId,
      resolvedLibraryPath,
      dataPath,
      resumeSession ? { resumeSession } : undefined,
    );

    // Persist the active session file path in DB so server restarts resume correctly
    const sessionFile = piSession.getSessionFile();
    console.log(`[tree-manager] Session created — user: ${userId}, file: ${sessionFile}`);
    let dbId: number | undefined;
    if (sessionFile) {
      dbId = TreeManager.writeActiveSession(userId, bookId, sessionFile, options?.sessionId);
    }

    const tm = new TreeManager(piSession, userId, bookId, library);
    tm.sessionDbId = dbId ?? TreeManager.readSessionDbId(userId, bookId, options?.sessionId) ?? 0;
    return tm;
  }

  /**
   * Read the active session file path for a user+book from the DB.
   *
   * @param sessionId — When provided, looks up that specific row by ID.
   *   When omitted, finds the most recently active session.
   */
  private static readActiveSession(
    userId: string,
    bookId: string,
    sessionId?: number,
  ): string | undefined {
    try {
      const db = getDb();

      // If a specific session ID was requested, look it up directly
      if (sessionId !== undefined) {
        const row = db
          .select()
          .from(userBookSessions)
          .where(
            and(
              eq(userBookSessions.id, sessionId),
              eq(userBookSessions.userId, userId),
              eq(userBookSessions.bookId, bookId),
            ),
          )
          .get();
        if (!row) return undefined;
        console.log(`[tree-manager] Resuming session #${sessionId} for ${userId}/${bookId}: ${row.sessionFile}`);
        return row.sessionFile;
      }

      // Fallback: most recently active session
      const row = db
        .select()
        .from(userBookSessions)
        .where(
          and(
            eq(userBookSessions.userId, userId),
            eq(userBookSessions.bookId, bookId),
            eq(userBookSessions.isActive, 1),
          ),
        )
        .get();

      if (!row) return undefined;

      console.log(`[tree-manager] Resuming session for ${userId}/${bookId}: ${row.sessionFile}`);
      return row.sessionFile;
    } catch {
      return undefined; // DB not ready or no rows — first session
    }
  }

  /**
   * Read the DB row ID of the active session for a user+book.
   *
   * @param sessionId — When provided, verifies that specific row exists.
   *   When omitted, finds the most recently active session.
   */
  private static readSessionDbId(
    userId: string,
    bookId: string,
    sessionId?: number,
  ): number | undefined {
    try {
      const db = getDb();

      if (sessionId !== undefined) {
        const row = db
          .select({ id: userBookSessions.id })
          .from(userBookSessions)
          .where(
            and(
              eq(userBookSessions.id, sessionId),
              eq(userBookSessions.userId, userId),
              eq(userBookSessions.bookId, bookId),
            ),
          )
          .get();
        return row?.id;
      }

      const row = db
        .select({ id: userBookSessions.id })
        .from(userBookSessions)
        .where(
          and(
            eq(userBookSessions.userId, userId),
            eq(userBookSessions.bookId, bookId),
            eq(userBookSessions.isActive, 1),
          ),
        )
        .get();
      return row?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Write/upsert the active session file path to the DB.
   *
   * When sessionId is provided, updates that specific row (multi-session mode).
   * When sessionId is omitted, deactivates previous sessions and inserts/upserts
   * (legacy single-session behavior).
   *
   * @returns The DB row ID of the written/updated session.
   */
  private static writeActiveSession(
    userId: string,
    bookId: string,
    sessionFile: string,
    sessionId?: number,
  ): number | undefined {
    try {
      const db = getDb();
      const now = new Date().toISOString();

      // Ensure the user exists for backward compatibility
      TreeManager.ensureUser(userId);

      // If we have a specific session ID, update that row directly
      if (sessionId !== undefined) {
        db.update(userBookSessions)
          .set({
            sessionFile,
            isActive: 1,
            lastActiveAt: now,
          })
          .where(eq(userBookSessions.id, sessionId))
          .run();
        return sessionId;
      }

      // Legacy: deactivate previous sessions for this user+book
      db.update(userBookSessions)
        .set({ isActive: 0 })
        .where(
          and(
            eq(userBookSessions.userId, userId),
            eq(userBookSessions.bookId, bookId),
          ),
        )
        .run();

      // Insert or update the current session
      db.insert(userBookSessions)
        .values({
          userId,
          bookId,
          sessionFile,
          isActive: 1,
          createdAt: now,
          lastActiveAt: now,
        })
        .onConflictDoUpdate({
          target: [
            userBookSessions.userId,
            userBookSessions.bookId,
            userBookSessions.sessionFile,
          ],
          set: {
            isActive: 1,
            lastActiveAt: now,
          },
        })
        .run();

      // Return the ID of the row we just wrote
      const row = db
        .select({ id: userBookSessions.id })
        .from(userBookSessions)
        .where(
          and(
            eq(userBookSessions.userId, userId),
            eq(userBookSessions.bookId, bookId),
            eq(userBookSessions.isActive, 1),
          ),
        )
        .get();
      return row?.id;
    } catch (err) {
      console.warn(`[tree-manager] Failed to persist session: ${err}`);
      return undefined;
    }
  }

  /**
   * Ensure a user row exists (auto-create for backward compatibility).
   */
  private static ensureUser(userId: string): void {
    const db = getDb();
    const existing = db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!existing) {
      const now = new Date().toISOString();
      db.insert(users)
        .values({
          id: userId,
          displayName: userId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
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
      onCompaction?: (event: { type: string; reason: string }) => Promise<void>;
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

    // Emit a tree snapshot on the first AI token — by that point the user
    // message has been appended, so the tree accurately reflects the new
    // branch.  This lets the sidebar update immediately instead of waiting
    // for the full AI response to finish.
    const wrappedOnToken = wrapTokenWithEarlyTreeUpdate(
      callbacks.onToken,
      async () => callbacks.onTreeUpdate({ tree: this.buildTreeView() }),
    );

    // Stream the response from Pi
    const { response } = await this.piSession.sendMessageStreaming(
      message,
      wrappedOnToken,
      callbacks.onCompaction,
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
      sessionId: this.sessionDbId,
      userId: this.userId,
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

  getBreadcrumb(): import("@pi-books/shared").BreadcrumbItem[] {
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
  // Delete (soft-delete / abandon) a node
  // ---------------------------------------------------------------------------

  deleteNode(nodeId: string, viewNodeId: string | null): SessionState {
    this.piSession.updateStatus(nodeId, "abandoned");
    return this.getSessionState(viewNodeId);
  }

  renameNode(nodeId: string, newLabel: string, viewNodeId: string | null): SessionState {
    this.piSession.updateLabel(nodeId, newLabel);
    return this.getSessionState(viewNodeId);
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
      lookup: { ...this.config.lookup, ...partial.lookup },
    };
  }

}
