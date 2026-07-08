import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
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

let dbInstance: LibSQLDatabase | null = null;
let dbPromise: Promise<LibSQLDatabase> | null = null;
let client: Client | null = null;

export async function getNewsDb(dataDir: string) {
  if (dbInstance) return dbInstance;
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    // PI_TREE_NEWS_DB_URL points at a remote sqld/libsql-server endpoint
    // (http:// or libsql://) — used when the data dir is on a network
    // filesystem, where local SQLite files are unsafe.
    const remoteUrl = process.env.PI_TREE_NEWS_DB_URL;
    if (remoteUrl) {
      console.log(`[news-db] Connecting to remote database at ${remoteUrl}`);
      client = createClient({
        url: remoteUrl,
        ...(process.env.PI_TREE_NEWS_DB_AUTH_TOKEN
          ? { authToken: process.env.PI_TREE_NEWS_DB_AUTH_TOKEN }
          : {}),
      });
    } else {
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, "news.db");
      client = createClient({ url: `file:${dbPath}` });
    }

    const db = drizzle(client);

    // Run pending migrations (auto-generated SQL in drizzle/ folder)
    console.log(`[news-db] Checking for pending migrations...`);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("[news-db] Migrations up to date");

    dbInstance = db;
    return db;
  })();

  return dbPromise;
}

export async function closeNewsDb() {
  // Await any in-flight DB initialization (e.g. migrate()) before closing,
  // otherwise the client gets closed while migrate() is still running.
  if (dbPromise) {
    try {
      await dbPromise;
    } catch {
      // Ignore — we're closing anyway
    }
  }
  if (client) {
    client.close();
    client = null;
    dbInstance = null;
    dbPromise = null;
  }
}

/**
 * Reset the news DB connection. Used in tests to get a fresh DB.
 */
export async function resetNewsDb() {
  await closeNewsDb();
}
