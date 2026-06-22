/**
 * SourceService — typed service layer for source queries.
 *
 * Wraps raw Drizzle queries that extensions previously did inline.
 * Extensions should use this instead of importing db/schema directly.
 */

import { eq, not, like, and, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { sources as sourcesTable } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SourceInfo {
  id: string;
  type: string;
  title: string;
  subtitle?: string | null;
  author: string;
  year: number | null;
  source?: string;
  status?: string;
  error?: string | null;
  metadata?: any;
  coverUrl?: string | null;
}

export interface SourceListItem {
  id: string;
  type: string;
  title: string;
  author: string;
  year: number | null;
}

export interface SourceListFilter {
  type?: string;
  search?: string;
}

export interface CreateSourceInput {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  author?: string;
  year?: number;
  source?: string;
  status?: string;
  error?: string | null;
  metadata?: any;
  coverUrl?: string;
}

export interface SourceService {
  /** List sources, excluding type='router'. Optional type & search filters. */
  list(filter?: SourceListFilter): SourceListItem[];
  /** Get full source info by ID. Returns null if not found. */
  get(id: string): SourceInfo | null;
  /** Create a new source. No-ops if ID already exists. */
  create(input: CreateSourceInput): SourceInfo;
  /** Update an existing source. Only provided fields are updated. */
  update(id: string, fields: Partial<Omit<CreateSourceInput, "id">>): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type SourcesSchema = typeof sourcesTable;

export class SourceServiceImpl implements SourceService {
  constructor(
    private getDb: () => BetterSQLite3Database<any>,
    private sources: SourcesSchema,
  ) {}

  list(filter?: SourceListFilter): SourceListItem[] {
    const db = this.getDb();
    const s = this.sources;

    const conditions: ReturnType<typeof eq>[] = [
      not(eq(s.type, "router")),
    ];

    if (filter?.type) {
      conditions.push(eq(s.type, filter.type));
    }

    if (filter?.search) {
      const pattern = `%${filter.search}%`;
      conditions.push(
        or(
          like(s.title, pattern),
          like(s.author, pattern),
        )!,
      );
    }

    return db
      .select({
        id: s.id,
        title: s.title,
        author: s.author,
        type: s.type,
        year: s.year,
      })
      .from(s)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(s.title)
      .all() as SourceListItem[];
  }

  get(id: string): SourceInfo | null {
    const db = this.getDb();
    const s = this.sources;

    const row = db
      .select()
      .from(s)
      .where(eq(s.id, id))
      .get();

    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      author: row.author,
      year: row.year,
      source: row.source,
      status: row.status,
      error: row.error,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      coverUrl: row.coverUrl,
    };
  }

  create(input: CreateSourceInput): SourceInfo {
    const db = this.getDb();
    const s = this.sources;
    const now = new Date().toISOString();

    db.insert(s)
      .values({
        id: input.id,
        type: input.type,
        title: input.title,
        subtitle: input.subtitle ?? null,
        author: input.author ?? "",
        year: input.year ?? null,
        source: input.source ?? "system",
        status: input.status ?? "ready",
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        coverUrl: input.coverUrl ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    return this.get(input.id)!;
  }

  update(id: string, fields: Partial<Omit<CreateSourceInput, "id">>): void {
    const db = this.getDb();
    const s = this.sources;

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    if (fields.type !== undefined) updates.type = fields.type;
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.subtitle !== undefined) updates.subtitle = fields.subtitle;
    if (fields.author !== undefined) updates.author = fields.author;
    if (fields.year !== undefined) updates.year = fields.year;
    if (fields.source !== undefined) updates.source = fields.source;
    if (fields.status !== undefined) updates.status = fields.status;
    if (fields.error !== undefined) updates.error = fields.error;
    if (fields.metadata !== undefined) updates.metadata = JSON.stringify(fields.metadata);
    if (fields.coverUrl !== undefined) updates.coverUrl = fields.coverUrl;

    db.update(s).set(updates).where(eq(s.id, id)).run();
  }
}
