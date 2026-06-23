import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { dirname, join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Schema — news plugin's own tables
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
// Migrations folder — resolved relative to this file so it works in both
// dev (source) and production (dist/) builds.
//
//   dev:  packages/plugin-news/db.ts      → ./drizzle
//   prod: packages/plugin-news/dist/db.js → ../drizzle
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
// In dev, __dirname is packages/plugin-news/  → ./drizzle exists
// In prod, __dirname is packages/plugin-news/dist/ → ../drizzle exists

const MIGRATIONS_FOLDER = existsSync(join(__dirname, "drizzle"))
  ? join(__dirname, "drizzle")
  : join(__dirname, "../drizzle");

// ---------------------------------------------------------------------------
// Singleton DB connection
// ---------------------------------------------------------------------------

let dbInstance: BetterSQLite3Database | null = null;
let sqliteDb: InstanceType<typeof Database> | null = null;

export function getNewsDb(dataDir: string) {
  if (dbInstance) return dbInstance;
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "news.db");
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");

  dbInstance = drizzle(sqliteDb);

  // Run pending migrations (auto-generated SQL in drizzle/ folder)
  console.log(`[news-db] Checking for pending migrations...`);
  migrate(dbInstance, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("[news-db] Migrations up to date");

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
