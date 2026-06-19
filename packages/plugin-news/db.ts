import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Schema — news plugin's own tables (previously in server/db/schema.ts)
// ---------------------------------------------------------------------------

export const rssFeeds = sqliteTable("rss_feeds", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),  // FK to core sources.id (enforced in app code)
  name: text("name").notNull(),
  url: text("url").notNull(),
  tags: text("tags").notNull().default("[]"),
  isActive: integer("is_active").notNull().default(1),
  lastFetchTime: text("last_fetch_time"),
  lastFetchStatus: text("last_fetch_status"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const rssItems = sqliteTable("rss_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  feedId: text("feed_id").notNull(),  // FK to rssFeeds.id (same DB)
  url: text("url").notNull(),
  guid: text("guid").notNull().default(""),
  publishedAt: text("published_at"),
  summary: text("summary"),
  author: text("author"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  feedUrlIdx: uniqueIndex("rss_items_feed_url_idx").on(table.feedId, table.url),
}));

// ---------------------------------------------------------------------------
// Singleton DB connection
// ---------------------------------------------------------------------------

let dbInstance: ReturnType<typeof drizzle> | null = null;
let sqliteDb: InstanceType<typeof Database> | null = null;

export function getNewsDb(dataDir: string) {
  if (dbInstance) return dbInstance;
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "news.db");
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");

  // Create tables if they don't exist
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS rss_feeds (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_fetch_time TEXT,
      last_fetch_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rss_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      feed_id TEXT NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      guid TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      summary TEXT,
      author TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rss_items_feed_url_idx ON rss_items(feed_id, url);
  `);

  dbInstance = drizzle(sqliteDb);
  return dbInstance;
}

export function closeNewsDb() {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
    dbInstance = null;
  }
}

/**
 * Reset the news DB connection. Used in tests to get a fresh DB.
 */
export function resetNewsDb() {
  closeNewsDb();
}
