/**
 * API smoke tests — verify all route groups respond correctly.
 *
 * Uses Hono's built-in app.request() for in-process testing:
 * - No HTTP server started, no ports, no network
 * - Each test runs in ~5ms
 * - Deterministic: no flakiness from port conflicts or timing
 *
 * These tests intentionally SKIP routes that trigger the Pi SDK / LLM:
 * - POST /api/session/message (→ LLM)
 * - POST /api/session/message/stream (→ LLM + SSE)
 * - POST /api/session/navigate (→ LLM summarization)
 * - POST /api/session/navigate/toc (→ LLM)
 * - POST /api/dict/lookup/stream (→ LLM)
 *
 * They also skip routes that require a running Pi SDK session (getSession):
 * - POST /api/session/start, /view, /tree, /breadcrumb, etc.
 *
 * What IS tested: health, config, users CRUD, library listing,
 * sessions CRUD (metadata), glossary CRUD, tags.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { app } from "../app.js";
import { resetDb } from "../db/index.js";
import { resetServerConfig } from "../config.js";

// ── Test isolation ──────────────────────────────────────────────────────────

const TEST_DATA_PATH = process.env.DATA_PATH!;
const TEST_LIBRARY_PATH = process.env.LIBRARY_PATH!;

beforeAll(() => {
  // Ensure test directories exist
  mkdirSync(TEST_DATA_PATH, { recursive: true });
  mkdirSync(TEST_LIBRARY_PATH, { recursive: true });
});

afterAll(() => {
  // Close DB and clean up test directories
  resetDb();
  resetServerConfig();
  try {
    rmSync(TEST_DATA_PATH, { recursive: true, force: true });
    rmSync(TEST_LIBRARY_PATH, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(data: Record<string, unknown>) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

// ── Health ──────────────────────────────────────────────────────────────────

describe("Health", () => {
  it("GET /health → 200 + status ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", version: "0.1.0" });
  });
});

// ── Config ──────────────────────────────────────────────────────────────────

describe("Config", () => {
  it("GET /api/config → 200 + model fields", async () => {
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("readingModel");
    expect(body).toHaveProperty("lookupModel");
  });

  it("PUT /api/config → 200 + updates model", async () => {
    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingModel: "test-model" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.config.readingModel).toBe("test-model");
  });
});

// ── Users CRUD ──────────────────────────────────────────────────────────────

describe("Users CRUD", () => {
  const userId = "smoke-test-user";

  it("GET /api/users → 200 + empty array initially", async () => {
    const res = await app.request("/api/users");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("users");
    expect(Array.isArray(body.users)).toBe(true);
  });

  it("POST /api/users → 201 (create)", async () => {
    const res = await app.request("/api/users", json({ id: userId, displayName: "Smoke Test" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(userId);
    expect(body.displayName).toBe("Smoke Test");
  });

  it("POST /api/users → 409 (duplicate)", async () => {
    const res = await app.request("/api/users", json({ id: userId, displayName: "Dupe" }));
    expect(res.status).toBe(409);
  });

  it("POST /api/users → 400 (missing id)", async () => {
    const res = await app.request("/api/users", json({ displayName: "No ID" }));
    expect(res.status).toBe(400);
  });

  it("GET /api/users/:userId → 200", async () => {
    const res = await app.request(`/api/users/${userId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(userId);
  });

  it("GET /api/users/:userId → 404 (not found)", async () => {
    const res = await app.request("/api/users/nonexistent");
    expect(res.status).toBe(404);
  });

  it("PUT /api/users/:userId → 200 (update)", async () => {
    const res = await app.request(`/api/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Updated Name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe("Updated Name");
  });

  it("DELETE /api/users/:userId → 200", async () => {
    const res = await app.request(`/api/users/${userId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/users/:userId → 404 (already deleted)", async () => {
    const res = await app.request(`/api/users/${userId}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

// ── Library ─────────────────────────────────────────────────────────────────

describe("Library", () => {
  it("GET /api/library/books → 200 + books array", async () => {
    const res = await app.request("/api/library/books");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("books");
    expect(Array.isArray(body.books)).toBe(true);
  });

  it("GET /api/library/books/:bookId → 404 (nonexistent book)", async () => {
    const res = await app.request("/api/library/books/nonexistent-book");
    expect(res.status).toBe(404);
  });

  it("GET /api/library/books/:bookId/outline → 404 (nonexistent)", async () => {
    const res = await app.request("/api/library/books/nonexistent-book/outline");
    expect(res.status).toBe(404);
  });

  it("GET /api/library/books/:bookId/headings → 404 (nonexistent)", async () => {
    const res = await app.request("/api/library/books/nonexistent-book/headings");
    expect(res.status).toBe(404);
  });

  it("GET /api/library/tags → 200 + tags array", async () => {
    const res = await app.request("/api/library/tags");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tags");
    expect(Array.isArray(body.tags)).toBe(true);
  });

  it("GET /api/library/jobs → 200 + jobs array", async () => {
    const res = await app.request("/api/library/jobs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("jobs");
  });
});

// ── Sessions CRUD (metadata, no Pi SDK) ─────────────────────────────────────

describe("Sessions CRUD", () => {
  const userId = "session-test-user";
  const bookId = "test-book";
  let sessionId: number;

  beforeAll(async () => {
    // Create a user for session tests
    await app.request("/api/users", json({ id: userId, displayName: "Session Tester" }));
  });

  it("GET /api/sessions/:userId/:bookId → 200 + empty sessions", async () => {
    const res = await app.request(`/api/sessions/${userId}/${bookId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("POST /api/sessions/:userId/:bookId → 201 (create session)", async () => {
    const res = await app.request(
      `/api/sessions/${userId}/${bookId}`,
      json({ title: "Test Reading Session" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Test Reading Session");
    expect(body.id).toBeTypeOf("number");
    sessionId = body.id;
  });

  it("GET /api/sessions/:userId/:bookId → 200 + 1 session", async () => {
    const res = await app.request(`/api/sessions/${userId}/${bookId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].title).toBe("Test Reading Session");
  });

  it("PUT /api/sessions/:userId/:bookId/:sessionId → 200 (rename)", async () => {
    const res = await app.request(`/api/sessions/${userId}/${bookId}/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Session" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/sessions/:userId/:bookId/:sessionId → 200 (soft-delete)", async () => {
    const res = await app.request(`/api/sessions/${userId}/${bookId}/${sessionId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  afterAll(async () => {
    await app.request(`/api/users/${userId}`, { method: "DELETE" });
  });
});

// ── Glossary CRUD (no LLM — only DB operations) ────────────────────────────

describe("Glossary CRUD", () => {
  const userId = "glossary-test-user";
  const bookId = "test-book";

  beforeAll(async () => {
    await app.request("/api/users", json({ id: userId, displayName: "Glossary Tester" }));
  });

  it("GET /api/dict/glossary/:userId/:bookId → 200 + empty entries", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${bookId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("POST /api/dict/glossary/save → 200 (save entry)", async () => {
    const res = await app.request(
      "/api/dict/glossary/save",
      json({ userId, bookId, term: "protagonist", definition: "The main character" }),
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/dict/glossary/:userId/:bookId → 200 + 1 entry", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${bookId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].term).toBe("protagonist");
  });

  afterAll(async () => {
    await app.request(`/api/users/${userId}`, { method: "DELETE" });
  });
});
