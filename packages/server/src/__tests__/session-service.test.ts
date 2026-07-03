/**
 * SessionService unit tests
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

beforeAll(() => {
  mkdirSync(TEST_DATA_PATH, { recursive: true });
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

describe("SessionService", () => {
  it("resolves userId and sessionId from sessionFile", async () => {
    const db = await getDb();
    
    // Setup test data
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
    
    const sessionFile = join(TEST_DATA_PATH, "sessions", "testsource", "testuser", "123.jsonl");
    
    // Insert a session
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
    
    const sessionId = insertResult[0].id;
    
    // Initialize service
    const service = new SessionServiceImpl(getDb, userSessions, users);
    
    // Test resolveUserId
    const resolvedUserId = await service.resolveUserId(sessionFile);
    expect(resolvedUserId).toBe("testuser");
    
    // Test resolveSessionId
    const resolvedSessionId = await service.resolveSessionId(sessionFile);
    expect(resolvedSessionId).toBe(sessionId);
    
    // Test non-existent file
    const missingUserId = await service.resolveUserId("nonexistent.jsonl");
    expect(missingUserId).toBeUndefined();
    
    const missingSessionId = await service.resolveSessionId("nonexistent.jsonl");
    expect(missingSessionId).toBeUndefined();
  });
});
