/**
 * SourceService — typed service layer for source queries.
 *
 * Wraps raw Drizzle queries that extensions previously did inline.
 * Extensions should use this instead of importing db/schema directly.
 */

import { eq, not, like, and, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
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
  list(filter?: SourceListFilter): Promise<SourceListItem[]>;
  /** Get full source info by ID. Returns null if not found. */
  get(id: string): Promise<SourceInfo | null>;
  /** Create a new source. No-ops if ID already exists. */
  create(input: CreateSourceInput): Promise<SourceInfo>;
  /** Update an existing source. Only provided fields are updated. */
  update(id: string, fields: Partial<Omit<CreateSourceInput, "id">>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type SourcesSchema = typeof sourcesTable;

export class SourceServiceImpl implements SourceService {
  constructor(
    private getDb: () => Promise<LibSQLDatabase<any>>,
    private sources: SourcesSchema,
  ) {}

  async list(filter?: SourceListFilter): Promise<SourceListItem[]> {
    const db = await this.getDb();
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

    return await db
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

  async get(id: string): Promise<SourceInfo | null> {
    const db = await this.getDb();
    const s = this.sources;

    const row = await db
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

  async create(input: CreateSourceInput): Promise<SourceInfo> {
    const db = await this.getDb();
    const s = this.sources;
    const now = new Date().toISOString();

    await db.insert(s)
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

    return (await this.get(input.id))!;
  }

  async update(id: string, fields: Partial<Omit<CreateSourceInput, "id">>): Promise<void> {
    const db = await this.getDb();
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

    await db.update(s).set(updates).where(eq(s.id, id)).run();
  }
}
