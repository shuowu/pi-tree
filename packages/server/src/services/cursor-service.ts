/**
 * CursorService — generic per-user content stream position tracking.
 *
 * Plugins use this to track "where did the user leave off" in content
 * streams (RSS feeds, search results, channels, etc.).
 *
 * Stream keys are plugin-namespaced strings, e.g. "news/feed/hackernews".
 */

import { eq, and, inArray, like } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { contentCursors as cursorsTable } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CursorService {
  /** Get cursor values for specific stream keys. */
  get(userId: string, streamKeys: string[]): Promise<Map<string, string>>;
  /** Set cursor values (upsert). */
  set(userId: string, entries: Array<{ key: string; value: string }>): Promise<void>;
  /** Get all cursors matching a key prefix (e.g. "news/feed/"). */
  getByPrefix(userId: string, prefix: string): Promise<Map<string, string>>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type CursorsSchema = typeof cursorsTable;

export class CursorServiceImpl implements CursorService {
  constructor(
    private getDb: () => Promise<LibSQLDatabase<any>>,
    private cursors: CursorsSchema,
  ) {}

  async get(userId: string, streamKeys: string[]): Promise<Map<string, string>> {
    if (streamKeys.length === 0) return new Map();
    const db = await this.getDb();
    const rows = await db
      .select({
        streamKey: this.cursors.streamKey,
        cursorValue: this.cursors.cursorValue,
      })
      .from(this.cursors)
      .where(and(
        eq(this.cursors.userId, userId),
        inArray(this.cursors.streamKey, streamKeys),
      ))
      .all();
    return new Map(rows.map(r => [r.streamKey, r.cursorValue]));
  }

  async set(userId: string, entries: Array<{ key: string; value: string }>): Promise<void> {
    if (entries.length === 0) return;
    const db = await this.getDb();
    const now = new Date().toISOString();
    for (const { key, value } of entries) {
      await db.insert(this.cursors)
        .values({
          userId,
          streamKey: key,
          cursorValue: value,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [this.cursors.userId, this.cursors.streamKey],
          set: { cursorValue: value, updatedAt: now },
        })
        .run();
    }
  }

  async getByPrefix(userId: string, prefix: string): Promise<Map<string, string>> {
    const db = await this.getDb();
    const rows = await db
      .select({
        streamKey: this.cursors.streamKey,
        cursorValue: this.cursors.cursorValue,
      })
      .from(this.cursors)
      .where(and(
        eq(this.cursors.userId, userId),
        like(this.cursors.streamKey, `${prefix}%`),
      ))
      .all();
    return new Map(rows.map(r => [r.streamKey, r.cursorValue]));
  }
}
