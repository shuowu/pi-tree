/**
 * Database schema — Drizzle ORM definitions for SQLite.
 *
 * Generic "sources" model: books, news collections, papers, podcasts, etc.
 * are all stored in the `sources` table with a `type` discriminator.
 * Sessions, tags, config, and progress reference sources generically.
 *
 * Type-specific scalar metadata lives in the `metadata` JSON column.
 * Domain-specific collections (e.g. rss_feeds) live in plugin-owned databases.
 */

import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

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
  id: text("id").primaryKey(), // slug: "principles_dalio_2017", "news"
  type: text("type").notNull().default("book"), // source type discriminator — plugins define types
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
  context: text("context").notNull().default('{"mode":"reading"}'), // JSON SessionContext — mode resolved via profile chain
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
}, (table) => ({
  userSourceIdx: index("usc_user_source_idx").on(table.userId, table.sourceId),
}));

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
}, (table) => ({
  userSourceIdx: index("usp_user_source_idx").on(table.userId, table.sourceId),
}));

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
}, (table) => ({
  userSourceIdx: index("glossary_user_source_idx").on(table.userId, table.sourceId),
}));

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
// Token Usage — per-message AI token consumption tracking
// ---------------------------------------------------------------------------

export const messageUsage = sqliteTable("message_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id")
    .references(() => userSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().default(""),
  category: text("category").notNull().default("session"), // 'session' | 'router' | 'lookup'
  nodeId: text("node_id").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull().default(""),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  costTotal: real("cost_total"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  sessionIdx: index("mu_session_idx").on(table.sessionId),
  userIdx: index("mu_user_idx").on(table.userId),
  createdIdx: index("mu_created_idx").on(table.createdAt),
}));

