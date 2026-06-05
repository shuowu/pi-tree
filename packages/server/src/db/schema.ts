/**
 * Database schema — Drizzle ORM definitions for SQLite.
 *
 * All tables that support multi-user book sessions. The Pi SDK still owns
 * the JSONL session files; these tables track metadata only.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
// User ↔ Book sessions — tracks which JSONL file is active per user+book
// ---------------------------------------------------------------------------

export const userBookSessions = sqliteTable("user_book_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  bookId: text("book_id").notNull(),
  sessionFile: text("session_file").notNull(), // absolute path to JSONL
  isActive: integer("is_active").notNull().default(1), // boolean: 1 = active
  createdAt: text("created_at").notNull(),
  lastActiveAt: text("last_active_at").notNull(),
});

// ---------------------------------------------------------------------------
// User ↔ Book config — per-user per-book ReaderConfig blob
// ---------------------------------------------------------------------------

export const userBookConfig = sqliteTable("user_book_config", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  bookId: text("book_id").notNull(),
  config: text("config").notNull(), // JSON blob of ReaderConfig
}, () => []);

// ---------------------------------------------------------------------------
// User ↔ Book progress — reading position tracking
// ---------------------------------------------------------------------------

export const userBookProgress = sqliteTable("user_book_progress", {
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  bookId: text("book_id").notNull(),
  progress: real("progress").notNull().default(0),
  lastNodeId: text("last_node_id"),
  updatedAt: text("updated_at").notNull(),
}, () => []);

// ---------------------------------------------------------------------------
// Glossary — per-user per-book term definitions
// ---------------------------------------------------------------------------

export const glossaryEntries = sqliteTable("glossary_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  bookId: text("book_id").notNull(),
  term: text("term").notNull(),
  definition: text("definition"),
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Books — user-uploaded books
// ---------------------------------------------------------------------------

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  year: integer("year"),
  source: text("source").notNull().default("upload"),
  sourceFormat: text("source_format").notNull(),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  originalFilename: text("original_filename").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
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
// Book ↔ Tag junction
// ---------------------------------------------------------------------------

export const bookTags = sqliteTable("book_tags", {
  bookId: text("book_id").notNull(),
  tagId: integer("tag_id").notNull().references(() => tags.id),
}, () => []);
