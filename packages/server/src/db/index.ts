/**
 * Database connection — singleton backed by better-sqlite3 + Drizzle ORM.
 *
 * The DB file lives at `<LIBRARY_PATH>/../.pi-reader/pi-reader.db`.
 * Tables are created via Drizzle's push-style migration on first access.
 */

import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

// Re-export schema tables for convenient imports
export {
  users,
  userBookSessions,
  userBookConfig,
  userBookProgress,
  glossaryEntries,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db: BetterSQLite3Database<typeof schema> | null = null;

/**
 * Get the Drizzle database instance (lazy-initialized on first call).
 * Creates the DB file and directory if they don't exist, and ensures
 * all tables are created.
 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;

  const libraryPath =
    process.env.LIBRARY_PATH ??
    path.join(process.env.HOME ?? "~", "repos", "pi-books", "library");

  const dbDir = path.join(libraryPath, "..", ".pi-reader");
  const dbPath = path.join(dbDir, "pi-reader.db");

  // Ensure the directory exists
  mkdirSync(dbDir, { recursive: true });

  console.log(`[db] Opening database at ${dbPath}`);
  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  _db = drizzle(sqlite, { schema });

  // Create tables if they don't exist (push-style migration)
  ensureTables(sqlite);

  return _db;
}

// ---------------------------------------------------------------------------
// Table creation — equivalent to drizzle-kit push for bootstrap
// ---------------------------------------------------------------------------

function ensureTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      avatar_url    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_book_sessions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        TEXT NOT NULL REFERENCES users(id),
      book_id        TEXT NOT NULL,
      session_file   TEXT NOT NULL,
      is_active      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      UNIQUE(user_id, book_id, session_file)
    );

    CREATE TABLE IF NOT EXISTS user_book_config (
      user_id  TEXT NOT NULL REFERENCES users(id),
      book_id  TEXT NOT NULL,
      config   TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS user_book_progress (
      user_id     TEXT NOT NULL REFERENCES users(id),
      book_id     TEXT NOT NULL,
      progress    REAL NOT NULL DEFAULT 0,
      last_node_id TEXT,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS glossary_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL REFERENCES users(id),
      book_id     TEXT NOT NULL,
      term        TEXT NOT NULL,
      definition  TEXT,
      created_at  TEXT NOT NULL
    );
  `);
}
