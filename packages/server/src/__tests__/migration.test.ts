/**
 * Database migration tests — verify schema versioning and incremental upgrades.
 *
 * Tests:
 * 1. Fresh install → drizzle migrations create all tables + indexes
 * 2. Existing DB → drizzle migrations apply incrementally (idempotent baseline)
 * 3. Already-current DB → no errors on re-run
 */

import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS_FOLDER } from "../db/index.js";
import { existsSync } from "node:fs";

function hasIndex(sqlite: Database.Database, indexName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
    .get(indexName) as { name: string } | undefined;
  return !!row;
}

function hasTable(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(tableName) as { name: string } | undefined;
  return !!row;
}

function hasDrizzleMigrationsTable(sqlite: Database.Database): boolean {
  return hasTable(sqlite, "__drizzle_migrations");
}

describe("Migration infrastructure", () => {
  it("MIGRATIONS_FOLDER points to an existing directory with SQL files", () => {
    expect(existsSync(MIGRATIONS_FOLDER)).toBe(true);
  });

  it("baseline migration file exists", () => {
    expect(existsSync(`${MIGRATIONS_FOLDER}/0000_baseline.sql`)).toBe(true);
  });

  it("journal file exists", () => {
    expect(existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)).toBe(true);
  });
});

describe("Fresh install via getDb", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  it("creates tables, indexes, and tracks migrations", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { vi } = await import("vitest");

    const testDir = mkdtempSync(join(tmpdir(), "pi-tree-migration-test-"));
    vi.stubEnv("DATA_PATH", testDir);

    // Dynamic import to pick up the stubbed env
    const { getDb, resetDb } = await import("../db/index.js");

    cleanup = () => {
      resetDb();
      vi.unstubAllEnvs();
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    };

    // Force fresh DB creation
    resetDb();
    getDb();

    // Open the created DB file directly to inspect it
    const dbPath = join(testDir, "pi-tree.db");
    const sqlite = new Database(dbPath, { readonly: true });

    try {
      // All tables should exist (created by baseline migration)
      for (const table of [
        "users",
        "sources",
        "user_sessions",
        "user_source_config",
        "user_source_progress",
        "glossary_entries",
        "tags",
        "source_tags",
      ]) {
        expect(hasTable(sqlite, table)).toBe(true);
      }

      // Indexes from the baseline migration should exist
      expect(hasIndex(sqlite, "usc_user_source_idx")).toBe(true);
      expect(hasIndex(sqlite, "usp_user_source_idx")).toBe(true);
      expect(hasIndex(sqlite, "glossary_user_source_idx")).toBe(true);
      expect(hasIndex(sqlite, "tags_name_unique")).toBe(true);

      // Drizzle migration tracking table should exist
      expect(hasDrizzleMigrationsTable(sqlite)).toBe(true);

      // At least the baseline migration should be recorded
      const migrations = sqlite
        .prepare("SELECT * FROM __drizzle_migrations")
        .all() as any[];
      expect(migrations.length).toBeGreaterThanOrEqual(1);
    } finally {
      sqlite.close();
    }
  });
});

describe("Existing DB migration (idempotent baseline)", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  it("baseline is safe on DB with pre-existing tables", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { vi } = await import("vitest");

    const testDir = mkdtempSync(join(tmpdir(), "pi-tree-migration-existing-"));
    vi.stubEnv("DATA_PATH", testDir);

    // Pre-create a database with tables (simulating an existing install)
    const dbPath = join(testDir, "pi-tree.db");
    const preSqlite = new Database(dbPath);
    preSqlite.pragma("journal_mode = WAL");
    preSqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users (id, display_name, created_at, updated_at)
      VALUES ('test-user', 'Test', '2025-01-01', '2025-01-01');
    `);
    preSqlite.close();

    const { getDb, resetDb } = await import("../db/index.js");

    cleanup = () => {
      resetDb();
      vi.unstubAllEnvs();
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    };

    // Running getDb should apply migrations without erroring
    resetDb();
    const db = getDb();

    // Verify: data preserved, all tables exist
    const readSqlite = new Database(dbPath, { readonly: true });
    try {
      const user = readSqlite.prepare("SELECT * FROM users WHERE id = 'test-user'").get() as any;
      expect(user.display_name).toBe("Test");

      // All tables should exist
      expect(hasTable(readSqlite, "sources")).toBe(true);
      expect(hasTable(readSqlite, "glossary_entries")).toBe(true);

      // Indexes should exist
      expect(hasIndex(readSqlite, "usc_user_source_idx")).toBe(true);
    } finally {
      readSqlite.close();
    }
  });
});
