/**
 * Database schema — Drizzle ORM definitions for SQLite.
 *
 * Generic "sources" model: books, news collections, papers, podcasts, etc.
 * are all stored in the `sources` table with a `type` discriminator.
 * Sessions, tags, config, and progress reference sources generically.
 *
 * Type-specific scalar metadata lives in the `metadata` JSON column.
 * Type-specific collections (rss_feeds, rss_items) get dedicated tables
 * with a `source_id` FK.
 */

import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Users — simple identity, no auth
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // slug like "shuo", "alice"
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Sources — the universal "thing you have conversations about"
// ---------------------------------------------------------------------------

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(), // slug: "principles_dalio_2017", "news-tech"
  type: text("type").notNull().default("book"), // 'book' | 'news' | 'paper' | 'podcast' | ...
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  author: text("author").notNull().default(""),
  year: integer("year"),
  source: text("source").notNull().default("library"), // 'library' | 'upload' | 'system'
  status: text("status").notNull().default("ready"), // 'pending' | 'processing' | 'ready' | 'failed'
  error: text("error"),
  metadata: text("metadata"), // JSON blob for type-specific fields (BookMetadata, NewsMetadata, etc.)
  coverUrl: text("cover_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// User ↔ Source sessions — tracks which JSONL file is active per user+source
// ---------------------------------------------------------------------------

export const userSessions = sqliteTable("user_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  sourceId: text("source_id")
    .notNull()
    .references(() => sources.id),
  title: text("title").notNull().default("Session"),
  context: text("context").notNull().default('{"mode":"reading"}'), // JSON blob of SessionContext
  sessionFile: text("session_file").notNull(), // absolute path to JSONL
  isActive: integer("is_active").notNull().default(1), // boolean: 1 = active
  createdAt: text("created_at").notNull(),
  lastActiveAt: text("last_active_at").notNull(),
});

// ---------------------------------------------------------------------------
// User ↔ Source config — per-user per-source ReaderConfig blob
// ---------------------------------------------------------------------------

export const userSourceConfig = sqliteTable("user_source_config", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  sourceId: text("source_id").notNull(),
  config: text("config").notNull(), // JSON blob of ReaderConfig
}, () => []);

// ---------------------------------------------------------------------------
// User ↔ Source progress — reading position tracking
// ---------------------------------------------------------------------------

export const userSourceProgress = sqliteTable("user_source_progress", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  sourceId: text("source_id").notNull(),
  progress: real("progress").notNull().default(0),
  lastNodeId: text("last_node_id"),
  updatedAt: text("updated_at").notNull(),
}, () => []);

// ---------------------------------------------------------------------------
// Glossary — per-user per-source term definitions
// ---------------------------------------------------------------------------

export const glossaryEntries = sqliteTable("glossary_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  sourceId: text("source_id").notNull(),
  term: text("term").notNull(),
  definition: text("definition"),
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Tags — global tag definitions
// ---------------------------------------------------------------------------

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Source ↔ Tag junction (replaces both book_tags and feed_tags)
// ---------------------------------------------------------------------------

export const sourceTags = sqliteTable("source_tags", {
  sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, () => []);

// ---------------------------------------------------------------------------
// Background Jobs — tracks async background processing
// ---------------------------------------------------------------------------

export const backgroundJobs = sqliteTable("background_jobs", {
  id: text("id").primaryKey(), // job ID (uuid or slug)
  sourceId: text("source_id").notNull(),
  status: text("status").notNull().default("pending"), // 'pending' | 'processing' | 'completed' | 'failed'
  progress: integer("progress").notNull().default(0), // 0 to 100
  step: text("step").notNull().default("queued"), // e.g. 'parsing', 'outline', 'summary'
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// RSS Feeds — linked to a source of type='news'
// ---------------------------------------------------------------------------

export const rssFeeds = sqliteTable("rss_feeds", {
  id: text("id").primaryKey(),                         // e.g. "hacker-news"
  sourceId: text("source_id")                          // FK to sources.id (news collection)
    .notNull()
    .references(() => sources.id, { onDelete: "cascade" }),
  name: text("name").notNull(),                        // display name e.g. "Hacker News"
  url: text("url").notNull(),                          // RSS feed URL
  tags: text("tags").notNull().default("[]"),           // JSON array of tag strings e.g. '["tech","ai"]'
  isActive: integer("is_active").notNull().default(1), // 1 = active, 0 = disabled
  lastFetchTime: text("last_fetch_time"),              // ISO timestamp
  lastFetchStatus: text("last_fetch_status"),          // "success" | "failed"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// RSS cached feed entries
// ---------------------------------------------------------------------------

export const rssItems = sqliteTable("rss_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  feedId: text("feed_id").notNull().references(() => rssFeeds.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  guid: text("guid").notNull().default(""),
  publishedAt: text("published_at"),                   // ISO timestamp
  summary: text("summary"),                            // Snippet
  author: text("author"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  // Prevent duplicate items per feed — the crawler relies on this constraint
  feedUrlIdx: uniqueIndex("rss_items_feed_url_idx").on(table.feedId, table.url),
}));
