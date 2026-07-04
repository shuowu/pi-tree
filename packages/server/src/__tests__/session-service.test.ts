/**
 * SessionService unit tests — covers resolveUserId, resolveSessionId, getById.
 *
 * Uses a real SQLite DB in a temp directory — no mocks, no HTTP server.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Stub env vars BEFORE importing db so they pick up test paths.
const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-session-test-"));
const TEST_DATA_PATH = join(TEST_ROOT, "data");

vi.stubEnv("DATA_PATH", TEST_DATA_PATH);

const { getDb, resetDb } = await import("../db/index.js");
const { userSessions, users, sources } = await import("../db/schema.js");
const { SessionServiceImpl } = await import("../services/session-service.js");

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let sessionFile: string;
let insertedSessionId: number;
let service: InstanceType<typeof SessionServiceImpl>;

beforeAll(async () => {
  mkdirSync(TEST_DATA_PATH, { recursive: true });

  const db = await getDb();

  await db.insert(users).values({
    id: "testuser",
    displayName: "Test User",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await db.insert(sources).values({
    id: "testsource",
    type: "book",
    title: "Test Source",
    source: "library",
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  sessionFile = join(TEST_DATA_PATH, "sessions", "testsource", "testuser", "123.jsonl");

  const insertResult = await db.insert(userSessions).values({
    userId: "testuser",
    sourceId: "testsource",
    title: "Test Session",
    context: "{}",
    sessionFile,
    isActive: 1,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  }).returning({ id: userSessions.id });

  insertedSessionId = insertResult[0].id;
  service = new SessionServiceImpl(getDb, userSessions, users);
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

describe("SessionService", () => {
  it("resolveUserId returns the owner of a known session file", async () => {
    const userId = await service.resolveUserId(sessionFile);
    expect(userId).toBe("testuser");
  });

  it("resolveUserId returns undefined for an unknown session file", async () => {
    const userId = await service.resolveUserId("nonexistent.jsonl");
    expect(userId).toBeUndefined();
  });

  it("resolveSessionId returns the numeric ID for a known session file", async () => {
    const sessionId = await service.resolveSessionId(sessionFile);
    expect(sessionId).toBe(insertedSessionId);
  });

  it("resolveSessionId returns undefined for an unknown session file", async () => {
    const sessionId = await service.resolveSessionId("nonexistent.jsonl");
    expect(sessionId).toBeUndefined();
  });

  it("getById returns the session for a valid ID", async () => {
    const session = await service.getById(insertedSessionId);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(insertedSessionId);
    expect(session!.title).toBe("Test Session");
    expect(session!.sourceId).toBe("testsource");
    expect(session!.sessionFile).toBe(sessionFile);
  });

  it("getById returns null for a non-existent ID", async () => {
    const session = await service.getById(999999);
    expect(session).toBeNull();
  });
});
