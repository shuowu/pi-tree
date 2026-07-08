/**
 * Export/Import service — serialize sessions for sharing and backup.
 *
 * Two artifact kinds:
 *
 * 1. **Snapshot** (`SessionSnapshot`) — a sanitized, self-describing JSON of
 *    the session tree + per-node message contents. Embedded into the
 *    standalone HTML viewer (see export-template.ts). Contains no user IDs,
 *    file paths, or token/cost data.
 *
 * 2. **JSONL bundle** — a re-importable single file: line 1 is an
 *    `ExportHeader` (source + session metadata), the remaining lines are the
 *    raw Pi SDK session JSONL verbatim (full fidelity, resumable after
 *    import). The session header's `cwd` is rewritten to avoid leaking
 *    local paths.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { findNode, buildBreadcrumb } from "@pi-tree/core";
import type { TreeNodeView, ToolStep } from "@pi-tree/core";
import type { SessionContext, SourceSession } from "@pi-tree/shared";
import { getDb, userSessions, sources, users } from "../db/index.js";

export const EXPORT_BUNDLE_TYPE = "pi-tree-export";
export const EXPORT_BUNDLE_VERSION = 1;
export const SNAPSHOT_FORMAT = "pi-tree-session";
export const SNAPSHOT_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportSourceMeta {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  author?: string;
  year?: number;
}

/** First line of a JSONL export bundle. */
export interface ExportHeader {
  type: typeof EXPORT_BUNDLE_TYPE;
  version: number;
  exportedAt: string;
  source: ExportSourceMeta;
  session: {
    title: string;
    context: SessionContext;
  };
}

export interface MessageContent {
  role: string;
  content: string;
  timestamp: string;
  toolSteps?: ToolStep[];
}

/** Sanitized session snapshot embedded in the HTML export. */
export interface SessionSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  formatVersion: number;
  exportedAt: string;
  source: ExportSourceMeta;
  session: { title: string; mode?: string };
  tree: TreeNodeView;
  contents: Record<string, MessageContent>;
  /** Present when the export is scoped to a branch */
  branch?: { nodeId: string; label: string; path: string[] };
}

export interface ExportContext {
  sessionRow: {
    id: number;
    title: string;
    context: string;
    sessionFile: string;
  };
  sourceRow: {
    id: string;
    type: string;
    title: string;
    subtitle: string | null;
    author: string;
    year: number | null;
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function getDataPath(): string {
  return process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");
}

function parseContext(raw: string): SessionContext {
  try {
    return JSON.parse(raw) as SessionContext;
  } catch {
    return { mode: "reading" };
  }
}

export function sourceMetaFromRow(row: ExportContext["sourceRow"]): ExportSourceMeta {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    ...(row.author ? { author: row.author } : {}),
    ...(row.year != null ? { year: row.year } : {}),
  };
}

/** Turn a session title into a safe download filename stem. */
export function exportFilename(title: string, ext: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "session";
  return `${stem}.${ext}`;
}

/**
 * Load and validate the session + source rows for an export request.
 * Throws with a user-facing message when the session can't be exported.
 */
export async function loadExportContext(
  userId: string,
  sourceId: string,
  sessionId: number,
): Promise<ExportContext> {
  const db = await getDb();
  const sessionRow = await db
    .select({
      id: userSessions.id,
      title: userSessions.title,
      context: userSessions.context,
      sessionFile: userSessions.sessionFile,
    })
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
  if (!sessionRow) throw new Error("Session not found");

  const sourceRow = await db
    .select({
      id: sources.id,
      type: sources.type,
      title: sources.title,
      subtitle: sources.subtitle,
      author: sources.author,
      year: sources.year,
    })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .get();
  if (!sourceRow) throw new Error("Source not found");

  return { sessionRow, sourceRow };
}

// ---------------------------------------------------------------------------
// JSONL bundle — export
// ---------------------------------------------------------------------------

/**
 * Build a re-importable JSONL bundle for a session.
 * Line 1: ExportHeader. Lines 2+: raw session JSONL (cwd sanitized).
 */
export function buildJsonlBundle(ctx: ExportContext): string {
  const { sessionRow, sourceRow } = ctx;

  if (!existsSync(sessionRow.sessionFile)) {
    throw new Error("Session has no conversation content yet");
  }

  const raw = readFileSync(sessionRow.sessionFile, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    throw new Error("Session has no conversation content yet");
  }

  // Sanitize the Pi SDK session header: rewrite `cwd` (local path leak)
  try {
    const sdkHeader = JSON.parse(lines[0]);
    if (sdkHeader && typeof sdkHeader === "object" && "cwd" in sdkHeader) {
      sdkHeader.cwd = "/";
      lines[0] = JSON.stringify(sdkHeader);
    }
  } catch {
    // Not JSON — leave verbatim
  }

  const header: ExportHeader = {
    type: EXPORT_BUNDLE_TYPE,
    version: EXPORT_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    source: sourceMetaFromRow(sourceRow),
    session: {
      title: sessionRow.title,
      context: parseContext(sessionRow.context),
    },
  };

  return [JSON.stringify(header), ...lines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// JSONL bundle — import
// ---------------------------------------------------------------------------

export interface ParsedBundle {
  header: ExportHeader;
  sessionLines: string[];
}

/** Parse and validate an uploaded bundle. Throws on malformed input. */
export function parseImportBundle(text: string): ParsedBundle {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    throw new Error("Not a pi-tree export file (too short)");
  }

  let header: ExportHeader;
  try {
    header = JSON.parse(lines[0]) as ExportHeader;
  } catch {
    throw new Error("Not a pi-tree export file (invalid header)");
  }

  if (header.type !== EXPORT_BUNDLE_TYPE) {
    throw new Error("Not a pi-tree export file");
  }
  if (typeof header.version !== "number" || header.version > EXPORT_BUNDLE_VERSION) {
    throw new Error(
      `Unsupported export version ${header.version} — please update pi-tree`,
    );
  }
  if (!header.source?.id || !header.source?.title) {
    throw new Error("Export file is missing source metadata");
  }

  const sessionLines = lines.slice(1);

  // The first session line must be a Pi SDK session header
  try {
    const sdkHeader = JSON.parse(sessionLines[0]);
    if (sdkHeader?.type !== "session") {
      throw new Error();
    }
  } catch {
    throw new Error("Export file has malformed session data");
  }

  return { header, sessionLines };
}

/**
 * Import a bundle for a user: ensure user + source rows exist, write the
 * session JSONL to the user's session directory, insert a user_sessions row.
 *
 * The source row is created from the bundle's metadata when missing —
 * conversations stay readable even if the underlying content files
 * (book markdown etc.) aren't present.
 */
export async function importSessionBundle(
  userId: string,
  text: string,
): Promise<SourceSession> {
  const { header, sessionLines } = parseImportBundle(text);
  const db = await getDb();
  const now = new Date().toISOString();

  // Ensure user exists (mirrors TreeManager.ensureUser)
  const existingUser = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!existingUser) {
    await db.insert(users)
      .values({ id: userId, displayName: userId, createdAt: now, updatedAt: now })
      .run();
  }

  // Ensure source exists — create a minimal row from bundle metadata
  const src = header.source;
  const existingSource = await db.select({ id: sources.id }).from(sources)
    .where(eq(sources.id, src.id)).get();
  if (!existingSource) {
    await db.insert(sources)
      .values({
        id: src.id,
        type: src.type || "book",
        title: src.title,
        subtitle: src.subtitle ?? null,
        author: src.author ?? "",
        year: src.year ?? null,
        source: "upload",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // Write the session JSONL into this user's session directory,
  // matching the Pi SDK layout: <DATA_PATH>/sessions/<sourceId>/<userId>/
  const sessionDir = join(getDataPath(), "sessions", src.id, userId);
  mkdirSync(sessionDir, { recursive: true });
  const stamp = now.replace(/[:.]/g, "-");
  const sessionFile = join(sessionDir, `${stamp}_${randomUUID()}.jsonl`);
  writeFileSync(sessionFile, sessionLines.join("\n") + "\n", "utf-8");

  // Insert the session row
  const context: SessionContext = header.session?.context ?? { mode: "reading" };
  const [inserted] = await db.insert(userSessions)
    .values({
      userId,
      sourceId: src.id,
      title: header.session?.title ?? "Imported session",
      context: JSON.stringify(context),
      sessionFile,
      isActive: 1,
      createdAt: now,
      lastActiveAt: now,
    })
    .returning({ id: userSessions.id });

  return {
    id: inserted.id,
    title: header.session?.title ?? "Imported session",
    context,
    createdAt: now,
    lastActiveAt: now,
    isActive: true,
    sourceId: src.id,
    sourceTitle: src.title,
    sourceType: src.type as SourceSession["sourceType"],
  };
}

// ---------------------------------------------------------------------------
// Snapshot — for the HTML export
// ---------------------------------------------------------------------------

export function buildSnapshot(
  ctx: ExportContext,
  tree: TreeNodeView,
  contents: Record<string, MessageContent>,
  branchNodeId?: string,
): SessionSnapshot {
  const context = parseContext(ctx.sessionRow.context);
  const scoped = branchNodeId
    ? scopeToBranch(tree, contents, branchNodeId)
    : { tree, contents, branch: undefined };

  return {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    source: sourceMetaFromRow(ctx.sourceRow),
    session: {
      title: ctx.sessionRow.title,
      ...(context.mode ? { mode: context.mode } : {}),
    },
    tree: scoped.tree,
    contents: scoped.contents,
    ...(scoped.branch ? { branch: scoped.branch } : {}),
  };
}

/**
 * Scope a snapshot to a single branch: the full lineage from root down to
 * `nodeId` (each ancestor pruned to a single child — the next node on the
 * path) plus the entire subtree below it. The export thus carries the
 * branch's complete context, while **sibling branches and their contents
 * are excluded** — sharing a branch shares one thread through the tree,
 * not the rest of the conversation.
 */
export function scopeToBranch(
  tree: TreeNodeView,
  contents: Record<string, MessageContent>,
  nodeId: string,
): {
  tree: TreeNodeView;
  contents: Record<string, MessageContent>;
  branch: NonNullable<SessionSnapshot["branch"]>;
} {
  const target = findNode(tree, nodeId);
  if (!target) throw new Error("Branch node not found in session tree");

  // Breadcrumb includes root…target inclusive
  const crumbs = buildBreadcrumb(tree, nodeId);
  const pathIds = crumbs.map((c) => c.nodeId);

  // Ids to keep: the lineage plus the target's whole subtree
  const ids = new Set<string>(pathIds);
  const collect = (n: TreeNodeView) => {
    ids.add(n.id);
    for (const child of n.children ?? []) collect(child);
  };
  collect(target);

  // Prune ancestors to a single-child chain along the path
  const prune = (node: TreeNodeView, depth: number): TreeNodeView => {
    if (node.id === nodeId) return node;
    const next = (node.children ?? []).find((c) => c.id === pathIds[depth + 1]);
    return { ...node, children: next ? [prune(next, depth + 1)] : [] };
  };
  const prunedTree = prune(tree, 0);

  const scopedContents: Record<string, MessageContent> = {};
  for (const [id, content] of Object.entries(contents)) {
    if (ids.has(id)) scopedContents[id] = content;
  }

  return {
    tree: prunedTree,
    contents: scopedContents,
    branch: {
      nodeId,
      label: target.label,
      path: crumbs.slice(0, -1).map((b) => b.label),
    },
  };
}
