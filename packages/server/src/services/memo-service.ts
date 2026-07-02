/**
 * MemoService — CRUD and full-text search for user memos.
 *
 * Memos are user notes that can optionally be scoped to a source, session,
 * or conversation node. Supports tagging and FTS5 full-text search.
 */

import { join } from "node:path";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { getServerConfig } from "../config.js";
import { configureModelRegistry } from "@pi-tree/core";
import { getDb, memos, memoTags, tags, users } from "../db/index.js";
import type { Memo, MemoCreate, MemoUpdate } from "@pi-tree/shared";

// Singleton instance
let _instance: MemoService | null = null;

export class MemoService {
  private constructor() {}

  static getInstance(): MemoService {
    if (!_instance) {
      _instance = new MemoService();
    }
    return _instance;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure a user row exists (auto-create for backward compatibility).
   */
  private async ensureUser(userId: string): Promise<void> {
    const db = await getDb();
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();

    if (!existing) {
      const now = new Date().toISOString();
      await db.insert(users)
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
   * Resolve tag names to tag IDs, creating tags that don't exist yet.
   */
  private async resolveTagIds(tagNames: string[]): Promise<number[]> {
    if (tagNames.length === 0) return [];
    const db = await getDb();
    const ids: number[] = [];

    for (const name of tagNames) {
      const trimmed = name.trim().toLowerCase();
      if (!trimmed) continue;

      // INSERT OR IGNORE — tag may already exist
      await db.insert(tags)
        .values({ name: trimmed, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .run();

      // Now select the id
      const row = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.name, trimmed))
        .get();

      if (row) ids.push(row.id);
    }

    return ids;
  }

  /**
   * Sync memo ↔ tag associations: delete existing, insert new.
   */
  private async syncMemoTags(memoId: number, tagIds: number[]): Promise<void> {
    const db = await getDb();

    // Clear existing associations
    await db.delete(memoTags)
      .where(eq(memoTags.memoId, memoId))
      .run();

    // Insert new associations
    for (const tagId of tagIds) {
      await db.insert(memoTags)
        .values({ memoId, tagId })
        .run();
    }
  }

  /**
   * Fetch tag names for a memo.
   */
  private async getTagsForMemo(memoId: number): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ name: tags.name })
      .from(memoTags)
      .innerJoin(tags, eq(memoTags.tagId, tags.id))
      .where(eq(memoTags.memoId, memoId))
      .all();

    return rows.map((r) => r.name);
  }

  /**
   * Convert a raw DB row into a Memo shape.
   */
  private toMemo(row: typeof memos.$inferSelect, tagNames: string[]): Memo {
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      content: row.content,
      sourceId: row.sourceId,
      sessionId: row.sessionId,
      nodeId: row.nodeId,
      origin: row.origin as Memo["origin"],
      pinned: row.pinned === 1,
      tags: tagNames,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * List memos for a user with optional filters.
   */
  async list(
    userId: string,
    opts?: {
      sourceId?: string;
      tag?: string;
      pinned?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<Memo[]> {
    const db = await getDb();
    const conditions = [eq(memos.userId, userId)];

    if (opts?.sourceId) {
      conditions.push(eq(memos.sourceId, opts.sourceId));
    }
    if (opts?.pinned !== undefined) {
      conditions.push(eq(memos.pinned, opts.pinned ? 1 : 0));
    }

    let query = db
      .select()
      .from(memos)
      .where(and(...conditions))
      .orderBy(desc(memos.updatedAt));

    const rows = await query
      .limit(opts?.limit ?? 100)
      .offset(opts?.offset ?? 0)
      .all();

    // Filter by tag if specified (requires join through memo_tags)
    let results = rows;
    if (opts?.tag) {
      const tagRow = await db
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.name, opts.tag.toLowerCase()))
        .get();

      if (!tagRow) return [];

      const memoIdsWithTag = await db
        .select({ memoId: memoTags.memoId })
        .from(memoTags)
        .where(eq(memoTags.tagId, tagRow.id))
        .all();

      const taggedIds = new Set(memoIdsWithTag.map((r) => r.memoId));
      results = results.filter((r) => taggedIds.has(r.id));
    }

    // Hydrate tags for each memo
    const memosOut: Memo[] = [];
    for (const row of results) {
      const tagNames = await this.getTagsForMemo(row.id);
      memosOut.push(this.toMemo(row, tagNames));
    }

    return memosOut;
  }

  /**
   * Get a single memo by ID (scoped to user).
   */
  async get(userId: string, memoId: number): Promise<Memo | null> {
    const db = await getDb();
    const row = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.userId, userId)))
      .get();

    if (!row) return null;

    const tagNames = await this.getTagsForMemo(row.id);
    return this.toMemo(row, tagNames);
  }

  /**
   * Create a new memo with optional tags.
   */
  async create(userId: string, input: MemoCreate): Promise<Memo> {
    const db = await getDb();
    await this.ensureUser(userId);

    const now = new Date().toISOString();
    const [inserted] = await db
      .insert(memos)
      .values({
        userId,
        title: input.title,
        content: input.content,
        sourceId: input.sourceId ?? null,
        sessionId: input.sessionId ?? null,
        nodeId: input.nodeId ?? null,
        origin: input.origin ?? "manual",
        pinned: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: memos.id });

    // Associate tags
    if (input.tags && input.tags.length > 0) {
      const tagIds = await this.resolveTagIds(input.tags);
      await this.syncMemoTags(inserted.id, tagIds);
    }

    return (await this.get(userId, inserted.id))!;
  }

  /**
   * Update a memo (title, content, pinned, tags).
   */
  async update(userId: string, memoId: number, input: MemoUpdate): Promise<Memo | null> {
    const db = await getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.userId, userId)))
      .get();

    if (!existing) return null;

    const now = new Date().toISOString();
    const updates: Record<string, any> = { updatedAt: now };

    if (input.title !== undefined) updates.title = input.title;
    if (input.content !== undefined) updates.content = input.content;
    if (input.pinned !== undefined) updates.pinned = input.pinned ? 1 : 0;

    await db.update(memos)
      .set(updates)
      .where(eq(memos.id, memoId))
      .run();

    // Sync tags if provided
    if (input.tags !== undefined) {
      const tagIds = await this.resolveTagIds(input.tags);
      await this.syncMemoTags(memoId, tagIds);
    }

    return (await this.get(userId, memoId))!;
  }

  /**
   * Delete a memo (cascade deletes memo_tags).
   */
  async remove(userId: string, memoId: number): Promise<boolean> {
    const db = await getDb();

    // Verify ownership
    const existing = await db
      .select({ id: memos.id })
      .from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.userId, userId)))
      .get();

    if (!existing) return false;

    await db.delete(memos)
      .where(eq(memos.id, memoId))
      .run();

    return true;
  }

  /**
   * Append content to an existing memo with an optional source attribution header.
   */
  async append(
    userId: string,
    memoId: number,
    content: string,
    sourceId?: string,
  ): Promise<Memo | null> {
    const db = await getDb();

    const existing = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, memoId), eq(memos.userId, userId)))
      .get();

    if (!existing) return null;

    const now = new Date().toISOString();
    let appendText = content;
    if (sourceId) {
      appendText = `\n\n---\n*From: ${sourceId}*\n\n${content}`;
    } else {
      appendText = `\n\n${content}`;
    }

    const newContent = existing.content + appendText;

    await db.update(memos)
      .set({ content: newContent, updatedAt: now })
      .where(eq(memos.id, memoId))
      .run();

    return (await this.get(userId, memoId))!;
  }

  // ---------------------------------------------------------------------------
  // FTS5 Search
  // ---------------------------------------------------------------------------

  /**
   * Full-text search over memos using FTS5.
   * Parses `#tag` tokens out of the query string for combined FTS + tag filtering.
   */
  async search(
    userId: string,
    query: string,
    opts?: { sourceId?: string; tag?: string; limit?: number; offset?: number },
  ): Promise<Memo[]> {
    const db = await getDb();

    // Parse #tags from query
    const tagTokens: string[] = [];
    const ftsQuery = query
      .replace(/#(\w+)/g, (_match, tag) => {
        tagTokens.push(tag.toLowerCase());
        return "";
      })
      .trim();

    // Combine parsed tags with explicit tag filter
    if (opts?.tag) {
      tagTokens.push(opts.tag.toLowerCase());
    }

    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;

    let memoIds: number[];

    if (ftsQuery) {
      // FTS5 search — use raw SQL since Drizzle doesn't support virtual tables
      const ftsRows = await db.all<{ id: number }>(sql`
        SELECT m.id
        FROM memos m
        INNER JOIN memos_fts ON memos_fts.rowid = m.id
        WHERE memos_fts MATCH ${ftsQuery}
          AND m.user_id = ${userId}
          ${opts?.sourceId ? sql`AND m.source_id = ${opts.sourceId}` : sql``}
        ORDER BY rank
        LIMIT ${limit} OFFSET ${offset}
      `);
      memoIds = ftsRows.map((r) => r.id);
    } else if (tagTokens.length > 0) {
      // Tag-only search (no FTS query text)
      const rows = await db
        .select()
        .from(memos)
        .where(and(
          eq(memos.userId, userId),
          ...(opts?.sourceId ? [eq(memos.sourceId, opts.sourceId)] : []),
        ))
        .orderBy(desc(memos.updatedAt))
        .limit(limit)
        .offset(offset)
        .all();
      memoIds = rows.map((r) => r.id);
    } else {
      return [];
    }

    if (memoIds.length === 0) return [];

    // Filter by tags if any were parsed
    let filteredIds = memoIds;
    if (tagTokens.length > 0) {
      const tagRows = await db
        .select({ id: tags.id })
        .from(tags)
        .where(sql`${tags.name} IN ${tagTokens}`)
        .all();

      if (tagRows.length === 0) return [];

      const tagIdSet = new Set(tagRows.map((r) => r.id));
      const validMemoIds: Set<number> = new Set();

      for (const memoId of memoIds) {
        const associations = await db
          .select({ tagId: memoTags.tagId })
          .from(memoTags)
          .where(eq(memoTags.memoId, memoId))
          .all();

        const memoTagIds = associations.map((a) => a.tagId);
        // Memo must have ALL specified tags
        if (tagTokens.length <= memoTagIds.filter((id) => tagIdSet.has(id)).length) {
          validMemoIds.add(memoId);
        }
      }

      filteredIds = memoIds.filter((id) => validMemoIds.has(id));
    }

    // Hydrate full memos
    const results: Memo[] = [];
    for (const id of filteredIds) {
      const memo = await this.get(userId, id);
      if (memo) results.push(memo);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // AI Enrichment
  // ---------------------------------------------------------------------------

  /**
   * Create a fresh in-memory AgentSession for a single enrichment call.
   * Same pattern as DictionaryService.createLookupAgent().
   */
  private async createEnrichAgent(): Promise<AgentSession> {
    const serverConfig = getServerConfig();
    const repoRoot = join(import.meta.dirname, "../../../..");

    const { authStorage, modelRegistry, selectedModel } = configureModelRegistry({
      ...serverConfig,
      readingModel: serverConfig.lookupModel || serverConfig.readingModel,
    });

    const { session } = await createAgentSession({
      cwd: repoRoot,
      tools: [],
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      ...(selectedModel ? { model: selectedModel } : {}),
    });

    return session;
  }

  /**
   * AI-enrich a memo: generate a descriptive title and extract tags.
   * Uses a lightweight one-shot AI session (same pattern as DictionaryService).
   *
   * Best-effort — returns null if the memo is not found or AI call fails.
   */
  async enrich(userId: string, memoId: number, context?: {
    sourceTitle?: string;
    topicPath?: string;
    userNote?: string;
  }): Promise<Memo | null> {
    // Fetch the memo (verify ownership)
    const memo = await this.get(userId, memoId);
    if (!memo) return null;

    let agent: AgentSession | null = null;
    try {
      agent = await this.createEnrichAgent();

      const contextLines: string[] = [];
      if (context?.sourceTitle) contextLines.push(`- Source: ${context.sourceTitle}`);
      if (context?.topicPath) contextLines.push(`- Topic path: ${context.topicPath}`);
      if (context?.userNote) contextLines.push(`- User's note: "${context.userNote}"`);
      const contextBlock = contextLines.length > 0
        ? `\nContext:\n${contextLines.join("\n")}\n`
        : "";

      const prompt = `You are a note-taking assistant. Given the following memo content, generate:
1. A concise, descriptive title (max 80 chars) that captures the key insight
2. 2-4 relevant tags for categorization (lowercase, hyphenated)
${contextBlock}
Memo content:
${memo.content}

Respond in EXACTLY this JSON format, nothing else:
{"title": "...", "tags": ["tag1", "tag2"]}`;

      let fullResponse = "";
      const unsubscribe = agent.subscribe(async (event: AgentSessionEvent) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta"
        ) {
          fullResponse += event.assistantMessageEvent.delta ?? "";
        }
      });

      try {
        await agent.prompt(prompt);
      } finally {
        unsubscribe();
      }

      // Parse JSON from the response (handle markdown code fences)
      const jsonStr = fullResponse
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim();
      const parsed = JSON.parse(jsonStr) as { title?: string; tags?: string[] };

      const update: MemoUpdate = {};
      if (parsed.title && typeof parsed.title === "string") {
        update.title = parsed.title.slice(0, 80);
      }
      if (Array.isArray(parsed.tags) && parsed.tags.length > 0) {
        update.tags = parsed.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.toLowerCase().trim())
          .filter(Boolean)
          .slice(0, 6);
      }

      if (!update.title && !update.tags) return memo;

      return await this.update(userId, memoId, update);
    } catch (err) {
      // Enrichment is best-effort — silently return null on failure
      console.warn("[MemoService] enrich failed:", err);
      return null;
    } finally {
      agent?.dispose();
    }
  }
}
