/**
 * CursorService unit tests — covers get, set (upsert), getByPrefix, cascade on user delete.
 *
 * Uses a real SQLite DB in a temp directory — no mocks, no HTTP server.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Stub env vars BEFORE importing db so they pick up test paths.
const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-cursor-test-"));
const TEST_DATA_PATH = join(TEST_ROOT, "data");

vi.stubEnv("DATA_PATH", TEST_DATA_PATH);

const { getDb, resetDb } = await import("../db/index.js");
const { contentCursors, users } = await import("../db/schema.js");
const { CursorServiceImpl } = await import("../services/cursor-service.js");
const { eq } = await import("drizzle-orm");

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let service: InstanceType<typeof CursorServiceImpl>;

beforeAll(async () => {
  mkdirSync(TEST_DATA_PATH, { recursive: true });

  const db = await getDb();

  // Create test users
  const now = new Date().toISOString();
  await db.insert(users).values([
    { id: "alice", displayName: "Alice", createdAt: now, updatedAt: now },
    { id: "bob", displayName: "Bob", createdAt: now, updatedAt: now },
  ]);

  service = new CursorServiceImpl(getDb, contentCursors);
});

afterAll(() => {
  resetDb();
  vi.unstubAllEnvs();
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CursorService", () => {
  it("get returns empty map when no cursors exist", async () => {
    const result = await service.get("alice", ["news/feed/hn", "news/feed/tc"]);
    expect(result.size).toBe(0);
  });

  it("get returns empty map for empty streamKeys array", async () => {
    const result = await service.get("alice", []);
    expect(result.size).toBe(0);
  });

  it("set inserts new cursors", async () => {
    await service.set("alice", [
      { key: "news/feed/hackernews", value: "2026-07-01T00:00:00Z" },
      { key: "news/feed/techcrunch", value: "2026-07-02T00:00:00Z" },
    ]);

    const result = await service.get("alice", [
      "news/feed/hackernews",
      "news/feed/techcrunch",
    ]);
    expect(result.size).toBe(2);
    expect(result.get("news/feed/hackernews")).toBe("2026-07-01T00:00:00Z");
    expect(result.get("news/feed/techcrunch")).toBe("2026-07-02T00:00:00Z");
  });

  it("set upserts existing cursors (advances watermark)", async () => {
    await service.set("alice", [
      { key: "news/feed/hackernews", value: "2026-07-04T12:00:00Z" },
    ]);

    const result = await service.get("alice", ["news/feed/hackernews"]);
    expect(result.get("news/feed/hackernews")).toBe("2026-07-04T12:00:00Z");
  });

  it("set with empty entries is a no-op", async () => {
    await service.set("alice", []);
    // No error thrown
  });

  it("get only returns requested keys", async () => {
    const result = await service.get("alice", ["news/feed/hackernews"]);
    expect(result.size).toBe(1);
    expect(result.has("news/feed/techcrunch")).toBe(false);
  });

  it("get ignores keys that don't exist", async () => {
    const result = await service.get("alice", [
      "news/feed/hackernews",
      "news/feed/nonexistent",
    ]);
    expect(result.size).toBe(1);
    expect(result.get("news/feed/hackernews")).toBe("2026-07-04T12:00:00Z");
  });

  it("cursors are isolated per user", async () => {
    await service.set("bob", [
      { key: "news/feed/hackernews", value: "2026-06-01T00:00:00Z" },
    ]);

    const alice = await service.get("alice", ["news/feed/hackernews"]);
    const bob = await service.get("bob", ["news/feed/hackernews"]);

    // Alice's cursor was updated in a previous test
    expect(alice.get("news/feed/hackernews")).toBe("2026-07-04T12:00:00Z");
    // Bob's cursor is independent
    expect(bob.get("news/feed/hackernews")).toBe("2026-06-01T00:00:00Z");
  });

  it("getByPrefix returns all cursors matching prefix", async () => {
    // Alice has news/feed/hackernews and news/feed/techcrunch from earlier
    const result = await service.getByPrefix("alice", "news/feed/");
    expect(result.size).toBe(2);
    expect(result.has("news/feed/hackernews")).toBe(true);
    expect(result.has("news/feed/techcrunch")).toBe(true);
  });

  it("getByPrefix returns empty map for non-matching prefix", async () => {
    const result = await service.getByPrefix("alice", "paper/search/");
    expect(result.size).toBe(0);
  });

  it("getByPrefix does not match partial key segments", async () => {
    // Add a cursor with a different namespace
    await service.set("alice", [
      { key: "newsletter/daily", value: "2026-07-04T00:00:00Z" },
    ]);

    // "news/" should match "news/feed/*" but not "newsletter/*"
    const result = await service.getByPrefix("alice", "news/");
    expect(result.has("news/feed/hackernews")).toBe(true);
    expect(result.has("newsletter/daily")).toBe(false);
  });

  it("getByPrefix is isolated per user", async () => {
    const alice = await service.getByPrefix("alice", "news/feed/");
    const bob = await service.getByPrefix("bob", "news/feed/");

    expect(alice.size).toBe(2); // hackernews + techcrunch
    expect(bob.size).toBe(1);   // hackernews only
  });

  it("cursors cascade on user delete", async () => {
    const db = await getDb();

    // Verify bob has cursors
    const before = await service.getByPrefix("bob", "news/");
    expect(before.size).toBe(1);

    // Delete bob
    await db.delete(users).where(eq(users.id, "bob")).run();

    // Cursors should be gone
    const after = await service.getByPrefix("bob", "news/");
    expect(after.size).toBe(0);
  });
});
