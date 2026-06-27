/**
 * Database migration tests — verify schema versioning and incremental upgrades.
 *
 * Tests:
 * 1. Fresh install → drizzle migrations create all tables + indexes
 * 2. Existing DB → drizzle migrations apply incrementally (idempotent baseline)
 * 3. Already-current DB → no errors on re-run
 */

import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import { MIGRATIONS_FOLDER } from "../db/index.js";
import { existsSync } from "node:fs";

async function hasIndex(dbPath: string, indexName: string): Promise<boolean> {
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const result = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
      args: [indexName],
    });
    return result.rows.length > 0;
  } finally {
    client.close();
  }
}

async function hasTable(dbPath: string, tableName: string): Promise<boolean> {
  const client = createClient({ url: `file:${dbPath}` });
  try {
    const result = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      args: [tableName],
    });
    return result.rows.length > 0;
  } finally {
    client.close();
  }
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
    await getDb();

    // Open the created DB file directly to inspect it
    const dbPath = join(testDir, "pi-tree.db");

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
      expect(await hasTable(dbPath, table)).toBe(true);
    }

    // Indexes from the baseline migration should exist
    expect(await hasIndex(dbPath, "usc_user_source_idx")).toBe(true);
    expect(await hasIndex(dbPath, "usp_user_source_idx")).toBe(true);
    expect(await hasIndex(dbPath, "glossary_user_source_idx")).toBe(true);
    expect(await hasIndex(dbPath, "tags_name_unique")).toBe(true);

    // Drizzle migration tracking table should exist
    expect(await hasTable(dbPath, "__drizzle_migrations")).toBe(true);

    // At least the baseline migration should be recorded
    const inspectClient = createClient({ url: `file:${dbPath}` });
    try {
      const result = await inspectClient.execute("SELECT * FROM __drizzle_migrations");
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      inspectClient.close();
    }
  });
});

describe("Existing DB migration (idempotent baseline)", () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  it("baseline is safe on DB with pre-existing tables", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { vi } = await import("vitest");

    const testDir = mkdtempSync(join(tmpdir(), "pi-tree-migration-existing-"));
    vi.stubEnv("DATA_PATH", testDir);

    // Pre-create a database with tables (simulating an existing install)
    const dbPath = join(testDir, "pi-tree.db");
    const preClient = createClient({ url: `file:${dbPath}` });
    await preClient.execute("PRAGMA journal_mode = WAL");
    await preClient.execute(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await preClient.execute({
      sql: "INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      args: ["test-user", "Test", "2025-01-01", "2025-01-01"],
    });
    preClient.close();

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
    await getDb();

    // Verify: data preserved, all tables exist
    const readClient = createClient({ url: `file:${dbPath}` });
    try {
      const result = await readClient.execute({
        sql: "SELECT * FROM users WHERE id = ?",
        args: ["test-user"],
      });
      expect(result.rows[0].display_name).toBe("Test");

      // All tables should exist
      expect(await hasTable(dbPath, "sources")).toBe(true);
      expect(await hasTable(dbPath, "glossary_entries")).toBe(true);

      // Indexes should exist
      expect(await hasIndex(dbPath, "usc_user_source_idx")).toBe(true);
    } finally {
      readClient.close();
    }
  });
});
