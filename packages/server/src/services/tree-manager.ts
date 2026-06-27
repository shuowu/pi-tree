/**
 * TreeManager — orchestrates reading sessions.
 *
 * This is now a thin layer that:
 * 1. Classifies user intent (branch vs continue)
 * 2. Delegates tree operations to PiSession (which wraps Pi SDK)
 * 3. Manages reading-specific metadata (topic labels, content anchors)
 *
 * Pi SDK handles: session storage, tree structure, AI responses,
 * compaction, streaming, context building.
 */

import type {
  SessionState,
  TreeNodeView,
  BreadcrumbItem,
} from "@pi-tree/core";
import type { ReaderConfig, SessionContext } from "@pi-tree/shared";
import { DEFAULT_CONFIG } from "@pi-tree/shared";
import { getServerConfig } from "../config.js";
import {
  PiSession,
  type AnnotatedTreeNode,
  findBranchPoint,
  findDeepestLeaf,
  findPlaceholderChild,
  needsAutoBranch,
  findForkPoint,
  findCurrentNode,
  findParent,
  collectScopeMessages,
  buildBreadcrumb,
  stripPlaceholders,
  wrapTokenWithEarlyTreeUpdate,
} from "@pi-tree/core";
import { eq, and } from "drizzle-orm";
import { getDb, users, userSessions, sources } from "../db/index.js";
import { LibraryService } from "./library.js";
import { getAgentRegistry } from "./agent-registry.js";
import { findProviderForModel, resolveApiKey } from "./models-json.js";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";

export class TreeManager {
  private config: ReaderConfig;
  private sessionDbId: number = 0;

  private constructor(
    private piSession: PiSession,
    private userId: string,
    private sourceId: string,
    private library: LibraryService,
  ) {
    this.config = { ...DEFAULT_CONFIG };
  }

  /** Get the DB row ID of the active session */
  getSessionId(): number {
    return this.sessionDbId;
  }

  /**
   * Test-only factory — create a TreeManager with a mock PiSession,
   * bypassing `loadOrCreate` and all DB/env dependencies.
   *
   * @internal Only for unit tests. Not part of the public API.
   */
  static _createForTest(
    piSession: PiSession,
    opts?: { userId?: string; sourceId?: string; sessionDbId?: number },
  ): TreeManager {
    const tm = new TreeManager(
      piSession,
      opts?.userId ?? "test-user",
      opts?.sourceId ?? "test-source",
      null as unknown as LibraryService,
    );
    tm.sessionDbId = opts?.sessionDbId ?? 1;
    return tm;
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Load an existing tree session or start a new one.
   *
   * @param options.sessionId — When provided, loads the specific session by
   *   DB row ID. When omitted, loads the most recently active session for
   *   the user+source (backward compatible).
   * @param options.resumeSession — Legacy: explicit JSONL file path to resume.
   */
  static async loadOrCreate(
    userId: string,
    sourceId: string,
    options?: { sessionId?: number; resumeSession?: string },
  ): Promise<TreeManager> {
    const library = new LibraryService();
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");

    // Resolve which session file to resume:
    // 1. Explicit resumeSession path (legacy)
    // 2. sessionId → look up that specific row
    // 3. Most recently active session for user+source
    let resumeSession = options?.resumeSession;
    if (!resumeSession) {
      resumeSession = TreeManager.readActiveSession(userId, sourceId, options?.sessionId);
    }

    // Validate session file exists on disk. DB placeholders (e.g. "pending-*")
    // and stale paths from deleted session files should start a fresh session.
    if (resumeSession && !existsSync(resumeSession)) {
      console.log(`[tree-manager] Session file not found (${resumeSession}), starting fresh`);
      resumeSession = undefined;
    }

    const db = getDb();
    const sourceRow = db.select().from(sources).where(eq(sources.id, sourceId)).get();
    const resolvedLibraryPath = library.getSourcesPath();
    // Build PiSessionConfig — all env var resolution happens here in the app layer.
    // Core (PiSession) never reads process.env directly.
    const serverCfg = getServerConfig();
    const repoRoot = join(import.meta.dirname, "../../../..");

    const sourceType = sourceRow?.type ?? "unknown";

    // Read session context from DB (carries mode, optional skill/model overrides)
    const sessionContext = TreeManager.readSessionContext(userId, sourceId, options?.sessionId);

    // Resolve the session profile via the agent registry.
    // This replaces the old hardcoded sourceType === "router" branching.
    const registry = getAgentRegistry();
    const profile = registry.resolveProfile(sourceType, sessionContext?.mode ?? "reading", sessionContext);
    console.log(`[tree-manager] Resolved profile "${profile.resolvedFrom}" for ${sourceType}/${sessionContext?.mode ?? 'default'}`);

    // Resolve the effective model — session context override wins over profile.
    const effectiveModel = sessionContext?.model ?? profile.model ?? serverCfg.readingModel;

    // If the effective model belongs to a provider from $DATA_PATH/models.json
    // AND that provider is different from the env-configured one, use models.json's
    // config (baseUrl, apiKey, api). This enables multi-provider model switching
    // (e.g. env=zai for cloud, models.json=lmstudio for local).
    // We skip the override when the provider matches the env config, because the
    // env config (PI_API_KEY, PI_BASE_URL, etc.) is the source of truth for it.
    let providerOverride: Record<string, unknown> = {};
    const modelsJsonProvider = findProviderForModel(effectiveModel);
    if (modelsJsonProvider && modelsJsonProvider.name !== serverCfg.provider) {
      console.log(`[tree-manager] Model "${effectiveModel}" → provider "${modelsJsonProvider.name}" from models.json`);
      providerOverride = {
        provider: modelsJsonProvider.name,
        apiKey: resolveApiKey(modelsJsonProvider.config.apiKey),
        baseUrl: modelsJsonProvider.config.baseUrl,
        api: modelsJsonProvider.config.api,
        ...(modelsJsonProvider.config.compat ? { compat: modelsJsonProvider.config.compat } : {}),
      };
    }

    const systemContext = TreeManager.resolveSystemContext(
      registry, sourceType, sourceId, userId, sourceRow, resolvedLibraryPath,
    );

    const piSession = await PiSession.create(
      userId,
      sourceId,
      resolvedLibraryPath,
      dataPath,
      {
        ...(resumeSession ? { resumeSession } : {}),
        config: {
          ...serverCfg,
          ...providerOverride,
          repoRoot,
          skillPaths: profile.skillPaths,
          extensionPaths: profile.extensionPaths,
          excludeTools: profile.excludeTools,
          sourceType,
          readingModel: effectiveModel,
          systemContext,
        },
      },
    );

    // Persist the active session file path in DB so server restarts resume correctly
    const sessionFile = piSession.getSessionFile();
    console.log(`[tree-manager] Session created — user: ${userId}, file: ${sessionFile}`);
    let dbId: number | undefined;
    if (sessionFile) {
      dbId = TreeManager.writeActiveSession(userId, sourceId, sessionFile, options?.sessionId);
    }

    const tm = new TreeManager(piSession, userId, sourceId, library);
    tm.sessionDbId = dbId ?? TreeManager.readSessionDbId(userId, sourceId, options?.sessionId) ?? 0;
    return tm;
  }

  /**
   * Create an ephemeral session that lives only in memory.
   * Used for system sessions (e.g. the home-router) that don't need persistence.
   */
  static async createEphemeral(
    userId: string,
    sourceType: string,
    mode: string,
  ): Promise<TreeManager> {
    const library = new LibraryService();
    const dataPath =
      process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");
    const serverCfg = getServerConfig();
    const repoRoot = join(import.meta.dirname, "../../../..");

    const registry = getAgentRegistry();
    const profile = registry.resolveProfile(sourceType, mode, { mode });
    console.log(`[tree-manager] Ephemeral session: resolved profile "${profile.resolvedFrom}" for ${sourceType}/${mode}`);

    const syntheticSourceId = `_system_${sourceType}_${mode}`;
    const systemContext = TreeManager.resolveSystemContext(
      registry, sourceType, syntheticSourceId, userId, null, library.getSourcesPath(),
    );

    const piSession = await PiSession.create(
      userId,
      syntheticSourceId,
      library.getSourcesPath(),
      dataPath,
      {
        config: {
          ...serverCfg,
          repoRoot,
          skillPaths: profile.skillPaths,
          extensionPaths: profile.extensionPaths,
          excludeTools: profile.excludeTools,
          sourceType,
          ...(profile.model ? { readingModel: profile.model } : {}),
          systemContext,
        },
      },
    );

    console.log(`[tree-manager] Ephemeral session created — user: ${userId}, type: ${sourceType}/${mode}`);
    return new TreeManager(piSession, userId, syntheticSourceId, library);
  }

  /**
   * Read the active session file path for a user+source from the DB.
   *
   * @param sessionId — When provided, looks up that specific row by ID.
   *   When omitted, finds the most recently active session.
   */
  private static readActiveSession(
    userId: string,
    sourceId: string,
    sessionId?: number,
  ): string | undefined {
    try {
      const db = getDb();

      // If a specific session ID was requested, look it up directly
      if (sessionId !== undefined) {
        const row = db
          .select()
          .from(userSessions)
          .where(
            and(
              eq(userSessions.id, sessionId),
              eq(userSessions.userId, userId),
              eq(userSessions.sourceId, sourceId),
              eq(userSessions.isActive, 1),
            ),
          )
          .get();
        if (!row) return undefined;
        console.log(`[tree-manager] Resuming session #${sessionId} for ${userId}/${sourceId}: ${row.sessionFile}`);
        return row.sessionFile;
      }

      // Fallback: most recently active session
      const row = db
        .select()
        .from(userSessions)
        .where(
          and(
            eq(userSessions.userId, userId),
            eq(userSessions.sourceId, sourceId),
            eq(userSessions.isActive, 1),
          ),
        )
        .get();

      if (!row) return undefined;

      console.log(`[tree-manager] Resuming session for ${userId}/${sourceId}: ${row.sessionFile}`);
      return row.sessionFile;
    } catch {
      return undefined; // DB not ready or no rows — first session
    }
  }

  /**
   * Read the SessionContext for a user+source session from the DB.
   * Returns the parsed context, or a default if not found.
   */
  private static readSessionContext(
    userId: string,
    sourceId: string,
    sessionId?: number,
  ): SessionContext | undefined {
    try {
      const db = getDb();

      const whereClause = sessionId !== undefined
        ? and(
            eq(userSessions.id, sessionId),
            eq(userSessions.userId, userId),
            eq(userSessions.sourceId, sourceId),
            eq(userSessions.isActive, 1),
          )
        : and(
            eq(userSessions.userId, userId),
            eq(userSessions.sourceId, sourceId),
            eq(userSessions.isActive, 1),
          );

      const row = db
        .select({ context: userSessions.context })
        .from(userSessions)
        .where(whereClause)
        .get();

      if (!row) return undefined;
      return JSON.parse(row.context) as SessionContext;
    } catch {
      return undefined;
    }
  }

  /**
   * Read the DB row ID of the active session for a user+source.
   *
   * @param sessionId — When provided, verifies that specific row exists.
   *   When omitted, finds the most recently active session.
   */
  private static readSessionDbId(
    userId: string,
    sourceId: string,
    sessionId?: number,
  ): number | undefined {
    try {
      const db = getDb();

      if (sessionId !== undefined) {
        const row = db
          .select({ id: userSessions.id })
          .from(userSessions)
          .where(
            and(
              eq(userSessions.id, sessionId),
              eq(userSessions.userId, userId),
              eq(userSessions.sourceId, sourceId),
              eq(userSessions.isActive, 1),
            ),
          )
          .get();
        return row?.id;
      }

      const row = db
        .select({ id: userSessions.id })
        .from(userSessions)
        .where(
          and(
            eq(userSessions.userId, userId),
            eq(userSessions.sourceId, sourceId),
            eq(userSessions.isActive, 1),
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
    sourceId: string,
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
        db.update(userSessions)
          .set({
            sessionFile,
            lastActiveAt: now,
          })
          .where(
            and(
              eq(userSessions.id, sessionId),
              eq(userSessions.isActive, 1),
            ),
          )
          .run();
        return sessionId;
      }

      // Legacy: deactivate previous sessions for this user+source
      db.update(userSessions)
        .set({ isActive: 0 })
        .where(
          and(
            eq(userSessions.userId, userId),
            eq(userSessions.sourceId, sourceId),
          ),
        )
        .run();

      // Insert or update the current session
      db.insert(userSessions)
        .values({
          userId,
          sourceId,
          sessionFile,
          isActive: 1,
          createdAt: now,
          lastActiveAt: now,
        })
        .onConflictDoUpdate({
          target: [
            userSessions.userId,
            userSessions.sourceId,
            userSessions.sessionFile,
          ],
          set: {
            isActive: 1,
            lastActiveAt: now,
          },
        })
        .run();

      // Return the ID of the row we just wrote
      const row = db
        .select({ id: userSessions.id })
        .from(userSessions)
        .where(
          and(
            eq(userSessions.userId, userId),
            eq(userSessions.sourceId, sourceId),
            eq(userSessions.isActive, 1),
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

  /**
   * Scan an extensions parent directory for individual extension subdirectories.
   * Pi SDK expects paths to individual extension dirs (each with index.ts/js),
   * not the parent directory itself.
   */
  private static scanExtensionDirs(parentDir: string): string[] {
    if (!existsSync(parentDir)) return [];
    try {
      return readdirSync(parentDir)
        .map((name) => join(parentDir, name))
        .filter((p) => {
          try {
            return (
              statSync(p).isDirectory() &&
              (existsSync(join(p, "index.ts")) || existsSync(join(p, "index.js")))
            );
          } catch {
            return false;
          }
        });
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Core: Handle a user message
  // ---------------------------------------------------------------------------

  async handleMessage(
    message: string,
    viewNodeId?: string | null,
    opts?: { forceBranch?: boolean },
  ): Promise<SessionState & { response: string }> {
    const tree = this.buildTreeView();
    const effectiveViewNodeId = viewNodeId ?? tree.id ?? null;

    let didBranch = false;

    if (effectiveViewNodeId) {
      if (opts?.forceBranch) {
        // Explicit fork from ⑂ button
        const branchId = findBranchPoint(tree, effectiveViewNodeId);
        if (branchId) {
          const placeholder = findPlaceholderChild(tree, branchId);
          this.piSession.simpleBranch(placeholder?.id ?? branchId);
          didBranch = true;
        }
      } else {
        // Auto-branch only when the scope already has a fork (2+ children).
        const { branchId, placeholderId } = needsAutoBranch(tree, effectiveViewNodeId);
        if (branchId) {
          this.piSession.simpleBranch(placeholderId ?? branchId);
          didBranch = true;
        } else {
          // No branching needed — ensure the SDK pointer is at the deepest
          // leaf of the user's current view. Without this, the pointer may
          // be stranded on a different branch from a prior ⑂ click.
          const leafId = findDeepestLeaf(tree, effectiveViewNodeId);
          this.piSession.simpleBranch(leafId);
        }
      }
    }

    const { response } = await this.piSession.sendMessage(message);

    // After any branching (explicit or auto), redirect scope to the new
    // branch so follow-up messages continue linearly instead of
    // re-triggering auto-branch at the fork.
    let scopeNodeId = viewNodeId;
    if (didBranch || !scopeNodeId) {
      const postTree = this.buildTreeView();
      const current = findCurrentNode(postTree);
      if (current) {
        const parent = findParent(postTree, current.id);
        scopeNodeId = parent ? parent.id : current.id;
      }
    }

    return {
      ...this.getSessionState(scopeNodeId ?? null),
      response,
    };
  }

  async handleMessageStreaming(
    message: string,
    viewNodeId: string | null,
    callbacks: {
      onToken: (token: string) => Promise<void>;
      onTurnEnd?: () => Promise<void>;
      onToolCall?: (info: { toolName: string; args: Record<string, unknown> }) => Promise<void>;
      onToolResult?: (info: { toolName: string; result: unknown; isError: boolean }) => Promise<void>;
      onTreeUpdate: (update: Record<string, unknown>) => Promise<void>;
      onCompaction?: (event: { type: string; reason: string }) => Promise<void>;
      onDone: (result: Record<string, unknown>) => Promise<void>;
    },
    opts?: { forceBranch?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    const tree = this.buildTreeView();
    const effectiveViewNodeId = viewNodeId ?? tree.id ?? null;

    let didBranch = false;

    if (effectiveViewNodeId) {
      if (opts?.forceBranch) {
        const branchId = findBranchPoint(tree, effectiveViewNodeId);
        if (branchId) {
          const placeholder = findPlaceholderChild(tree, branchId);
          this.piSession.simpleBranch(placeholder?.id ?? branchId);
          didBranch = true;
        }
      } else {
        // Auto-branch: message goes to new branch.
        const { branchId, placeholderId } = needsAutoBranch(tree, effectiveViewNodeId);
        if (branchId) {
          this.piSession.simpleBranch(placeholderId ?? branchId);
          didBranch = true;
        } else {
          // No branching needed — ensure SDK pointer is at the correct leaf.
          const leafId = findDeepestLeaf(tree, effectiveViewNodeId);
          this.piSession.simpleBranch(leafId);
        }
      }
    }

    const wrappedOnToken = wrapTokenWithEarlyTreeUpdate(
      callbacks.onToken,
      async () => callbacks.onTreeUpdate({ tree: this.buildTreeView() }),
    );

    const { response } = await this.piSession.sendMessageStreaming(
      message,
      wrappedOnToken,
      callbacks.onTurnEnd,
      callbacks.onToolCall,
      callbacks.onCompaction,
      callbacks.onToolResult,
      opts?.signal,
    );

    // After any branching (explicit or auto), redirect scope to the new
    // branch so follow-up messages continue linearly.
    let scopeNodeId = viewNodeId;
    if (didBranch || !scopeNodeId) {
      const postTree = this.buildTreeView();
      const current = findCurrentNode(postTree);
      if (current) {
        const parent = findParent(postTree, current.id);
        scopeNodeId = parent ? parent.id : current.id;
      }
    }

    await callbacks.onDone({
      ...this.getSessionState(scopeNodeId),
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
    const outline = await this.library.getOutline(this.sourceId);
    if (!outline) throw new Error("No outline for this source");

    // Find the outline entry closest to this line
    const entry = this.findOutlineEntry(outline.entries, lineNumber);
    const label = entry?.title ?? `Section at L${lineNumber}`;

    // Create a new branch anchored to this source section
    const breadcrumb = this.piSession.getBreadcrumb();
    const rootId = breadcrumb[0]?.entryId;
    if (rootId) {
      this.piSession.branchAt(rootId, {
        label,
        source: "outline",
        status: "active",
        contentAnchor: {
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
  // Immediate fork — move the Pi SDK pointer without sending a message
  // ---------------------------------------------------------------------------

  /**
   * Immediately fork the conversation at the given node.
   *
   * Resolves the **grandparent AI node** via `findForkPoint` — when the
   * user clicks ⑂ on AI_c2, the fork happens at AI_c1 (one level up),
   * so that c2 and its continuation become one branch, and the next
   * message creates another.
   *
   * Uses `branchAt` to create a structural fork with a placeholder node.
   * The placeholder has messageCount=0 so it's hidden from branch cards
   * in the UI (filtered by collectScopeMessages). Once the user sends a
   * message, the branch becomes visible.
   *
   * Returns `{ state, forkScopeId }` where:
   *  - `state` is scoped to the clicked conversation turn (c2_user)
   *  - `forkScopeId` is the scope the client should use when sending
   *     the next message (so it branches at the correct level)
   */
  forkAtNode(viewNodeId: string): { state: SessionState; forkScopeId: string | null } {
    const tree = this.buildTreeView();
    const forkResult = findForkPoint(tree, viewNodeId);

    if (forkResult) {
      this.piSession.branchAt(forkResult.forkId, {
        label: "New branch",
        source: "fork",
        status: "placeholder",
      });
      // Find the parent user node of the fork point for message routing
      const forkParent = findParent(tree, forkResult.forkId);
      return {
        state: this.getSessionState(forkResult.scopeId),
        forkScopeId: forkParent?.id ?? null,
      };
    }

    // Fallback: node not found, return current state
    return { state: this.getSessionState(viewNodeId), forkScopeId: null };
  }

  // ---------------------------------------------------------------------------
  // State getters — transform Pi's tree into our API format
  // ---------------------------------------------------------------------------

  getSessionState(viewNodeId?: string | null): SessionState {
    const tree = this.buildTreeView();

    // Auto-resolve when viewNodeId is null/undefined (omitted — e.g. initial load).
    // Empty string "" means "explicitly root" (breadcrumb root click) and skips
    // auto-resolve so the user actually lands at root.
    let effectiveViewNodeId = viewNodeId ?? null;
    if (effectiveViewNodeId === null) {
      const currentNode = findCurrentNode(tree);
      if (currentNode) {
        const parent = findParent(tree, currentNode.id);
        effectiveViewNodeId = parent ? parent.id : currentNode.id;
      }
    }

    // Normalize "" → null so downstream (breadcrumb, URL) treats it as root.
    if (effectiveViewNodeId === "") effectiveViewNodeId = null;

    return this.buildScopedState(tree, effectiveViewNodeId);
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
    // Strip placeholder nodes first so that collectScopeMessages sees
    // the correct tree structure (placeholder children hoisted up as
    // proper branch siblings). The branching logic in handleMessage
    // operates on the raw tree before this point.
    const clientTree = stripPlaceholders(tree);

    const contentMap = this.piSession.getMessageContentMap();
    const { messages, branches, parentContext } = collectScopeMessages(
      clientTree,
      viewNodeId,
      contentMap,
    );

    // Build breadcrumb from the stripped tree so placeholder nodes
    // don't appear in the navigation trail.
    const breadcrumb = viewNodeId
      ? buildBreadcrumb(clientTree, viewNodeId)
      : [];

    return {
      sessionId: this.sessionDbId,
      userId: this.userId,
      sourceId: this.sourceId,
      activeNodeId:
        this.piSession.getBreadcrumb().slice(-1)[0]?.entryId ?? "",
      viewNodeId,
      breadcrumb,
      messages,
      tree: clientTree,
      branches,
      parentContext: parentContext.length > 0 ? parentContext : undefined,
    };
  }

  getTreeView(): TreeNodeView {
    return stripPlaceholders(this.buildTreeView());
  }

  getBreadcrumb(): BreadcrumbItem[] {
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
        label: this.sourceId,
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

  // ---------------------------------------------------------------------------
  // System context template resolution
  // ---------------------------------------------------------------------------

  private static resolveSystemContext(
    registry: ReturnType<typeof getAgentRegistry>,
    sourceType: string,
    sourceId: string,
    userId: string,
    sourceRow: { title: string; author: string; year: number | null; metadata: string | null } | null | undefined,
    sourcesBasePath: string,
  ): string | undefined {
    const stConfig = registry.getSourceTypes().find((st) => st.key === sourceType);
    if (!stConfig?.systemContext) return undefined;

    return resolveSystemContextTemplate(
      stConfig.systemContext, sourceId, userId, sourceRow,
      join(sourcesBasePath, sourceId),
    );
  }

}

// ---------------------------------------------------------------------------
// Exported for unit testing — pure function, no class dependencies
// ---------------------------------------------------------------------------

/**
 * Resolve a plugin's `systemContext` template array into a final string.
 *
 * Supported placeholders:
 * - `{sourceId}`, `{userId}` — always available
 * - `{title}`, `{author}`, `{year}` — from the source DB row
 * - `{<key>}` — any key from the source's `metadata` JSON column
 * - `{file:<path>}` — reads a file relative to the source directory and
 *   inlines its content. Gracefully replaced with "(not available)" if the
 *   file doesn't exist. Max 16 KB to avoid bloating the prompt.
 */
export function resolveSystemContextTemplate(
  template: string[],
  sourceId: string,
  userId: string,
  sourceRow: { title: string; author: string; year: number | null; metadata: string | null } | null | undefined,
  sourceDir: string,
): string {
  // Build replacement map: source-level fields + metadata JSON
  const vars: Record<string, string> = {
    sourceId,
    userId,
  };
  if (sourceRow) {
    if (sourceRow.title) vars.title = sourceRow.title;
    if (sourceRow.author) vars.author = sourceRow.author;
    if (sourceRow.year != null) vars.year = String(sourceRow.year);

    if (sourceRow.metadata) {
      try {
        const metadata = typeof sourceRow.metadata === "string"
          ? JSON.parse(sourceRow.metadata)
          : sourceRow.metadata;
        if (metadata && typeof metadata === "object") {
          for (const [key, val] of Object.entries(metadata)) {
            if (val !== null && val !== undefined && !(key in vars)) {
              vars[key] = String(val);
            }
          }
        }
      } catch (err) {
        console.warn(`[tree-manager] Failed to parse metadata for source ${sourceId}:`, err);
      }
    }
  }

  const MAX_FILE_SIZE = 16 * 1024; // 16 KB cap per file injection

  return template
    .map((line) => {
      // 1. Replace simple {key} placeholders
      let resolved = line;
      for (const [key, val] of Object.entries(vars)) {
        resolved = resolved.split(`{${key}}`).join(val);
      }

      // 2. Replace {file:path} placeholders with file contents
      resolved = resolved.replace(/\{file:([^}]+)\}/g, (_match, relPath: string) => {
        const filePath = join(sourceDir, relPath.trim());
        try {
          if (!existsSync(filePath)) return "(not available)";
          const content = readFileSync(filePath, "utf-8");
          if (content.length > MAX_FILE_SIZE) {
            return content.slice(0, MAX_FILE_SIZE) + "\n...(truncated)";
          }
          return content;
        } catch {
          return "(not available)";
        }
      });

      return resolved;
    })
    .join("\n");
}
