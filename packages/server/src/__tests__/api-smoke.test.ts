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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";

// Stub env vars BEFORE importing app/config so they pick up test paths.
const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-test-"));
const TEST_DATA_PATH = join(TEST_ROOT, "data");

vi.stubEnv("DATA_PATH", TEST_DATA_PATH);

// Now safe to import — modules will read our stubbed env vars.
const { app } = await import("../app.js");
const { resetDb, getDb, sources } = await import("../db/index.js");
const { resetServerConfig } = await import("../config.js");

// ── Test isolation ──────────────────────────────────────────────────────────

beforeAll(() => {
  mkdirSync(TEST_DATA_PATH, { recursive: true });
  // Library dir is now DATA_PATH/library/ — create it
  mkdirSync(join(TEST_DATA_PATH, "library"), { recursive: true });
});

afterAll(() => {
  resetDb();
  resetServerConfig();
  vi.unstubAllEnvs();
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
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
// ── Environment isolation ──────────────────────────────────────────────────

describe("Environment isolation", () => {
  it("uses mocked DATA_PATH, not system defaults", () => {
    expect(process.env.DATA_PATH).toBe(TEST_DATA_PATH);
    // Verify these are temp dirs, not real user data
    expect(TEST_DATA_PATH).toMatch(/pi-tree-test-/);
  });
});



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
  it("GET /api/library/sources → 200 + sources array", async () => {
    const res = await app.request("/api/library/sources");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("sources");
    expect(Array.isArray(body.sources)).toBe(true);
  });

  it("GET /api/library/sources/:sourceId → 404 (nonexistent book)", async () => {
    const res = await app.request("/api/library/sources/nonexistent-book");
    expect(res.status).toBe(404);
  });

  it("GET /api/library/sources/:sourceId/outline → 404 (nonexistent)", async () => {
    const res = await app.request("/api/library/sources/nonexistent-book/outline");
    expect(res.status).toBe(404);
  });

  it("GET /api/library/sources/:sourceId/headings → 404 (nonexistent)", async () => {
    const res = await app.request("/api/library/sources/nonexistent-book/headings");
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
  const sourceId = "test-book";
  let sessionId: number;

  beforeAll(async () => {
    // Create a user for session tests
    await app.request("/api/users", json({ id: userId, displayName: "Session Tester" }));
    // Create a source so FK constraint is satisfied
    const db = getDb();
    const now = new Date().toISOString();
    db.insert(sources).values({ id: sourceId, type: "book", title: "Test Book", author: "Test", source: "library", status: "ready", createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  });

  it("GET /api/sessions/:userId/:sourceId → 200 + empty sessions", async () => {
    const res = await app.request(`/api/sessions/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("POST /api/sessions/:userId/:sourceId → 201 (create session)", async () => {
    const res = await app.request(
      `/api/sessions/${userId}/${sourceId}`,
      json({ title: "Test Reading Session" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Test Reading Session");
    expect(body.id).toBeTypeOf("number");
    sessionId = body.id;
  });

  it("GET /api/sessions/:userId/:sourceId → 200 + 1 session", async () => {
    const res = await app.request(`/api/sessions/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].title).toBe("Test Reading Session");
  });

  it("PUT /api/sessions/:userId/:sourceId/:sessionId → 200 (rename)", async () => {
    const res = await app.request(`/api/sessions/${userId}/${sourceId}/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Session" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /api/sessions/:userId/:sourceId/:sessionId → 200 (soft-delete)", async () => {
    const res = await app.request(`/api/sessions/${userId}/${sourceId}/${sessionId}`, {
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
  const sourceId = "test-book";

  beforeAll(async () => {
    await app.request("/api/users", json({ id: userId, displayName: "Glossary Tester" }));
    // Create a source so FK constraint is satisfied
    const db = getDb();
    const now = new Date().toISOString();
    db.insert(sources).values({ id: sourceId, type: "book", title: "Test Book", author: "Test", source: "library", status: "ready", createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  });

  it("GET /api/dict/glossary/:userId/:sourceId → 200 + empty entries", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("entries");
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("POST /api/dict/glossary/save → 200 (save entry)", async () => {
    const res = await app.request(
      "/api/dict/glossary/save",
      json({ userId, sourceId, term: "protagonist", definition: "The main character" }),
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/dict/glossary/:userId/:sourceId → 200 + 1 entry", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].term).toBe("protagonist");
  });

  afterAll(async () => {
    await app.request(`/api/users/${userId}`, { method: "DELETE" });
  });
});

// ── Source Creation (metadata-only) ────────────────────────────────────────

describe("Source Creation", () => {
  it("POST /api/library/sources/create → 201 (paper)", async () => {
    const res = await app.request(
      "/api/library/sources/create",
      json({ title: "Attention Is All You Need", author: "Vaswani et al.", type: "paper" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("attention-is-all-you-need");
    expect(body.type).toBe("paper");
    expect(body.title).toBe("Attention Is All You Need");
    expect(body.author).toBe("Vaswani et al.");
    expect(body.status).toBe("ready");
    expect(body.source).toBe("user");
  });

  it("POST /api/library/sources/create → 201 (duplicate gets suffix)", async () => {
    const res = await app.request(
      "/api/library/sources/create",
      json({ title: "Attention Is All You Need", type: "paper" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("attention-is-all-you-need-1");
  });

  it("POST /api/library/sources/create → 201 with metadata", async () => {
    const res = await app.request(
      "/api/library/sources/create",
      json({
        title: "BERT",
        type: "paper",
        metadata: { arxivId: "1810.04805" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("bert");
    expect(body.metadata).toEqual({ arxivId: "1810.04805" });
  });

  it("POST /api/library/sources/create → 400 (missing title)", async () => {
    const res = await app.request(
      "/api/library/sources/create",
      json({ type: "paper" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("title");
  });

  it("POST /api/library/sources/create → 400 (missing type)", async () => {
    const res = await app.request(
      "/api/library/sources/create",
      json({ title: "Some Paper" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("type");
  });

  it("source appears in library listing", async () => {
    const res = await app.request("/api/library/sources?type=paper");
    expect(res.status).toBe(200);
    const body = await res.json();
    const paper = body.sources.find((s: any) => s.id === "attention-is-all-you-need");
    expect(paper).toBeDefined();
    expect(paper.type).toBe("paper");
  });

  afterAll(async () => {
    // Clean up created sources
    for (const id of ["attention-is-all-you-need", "attention-is-all-you-need-1", "bert"]) {
      await app.request(`/api/library/sources/${id}`, { method: "DELETE" });
    }
  });
});

// ── Markdown Upload ────────────────────────────────────────────────────────

describe("Markdown Upload", () => {
  it("markdown file is saved directly and marked ready", async () => {
    const { BookIngestionService } = await import("../services/book-ingestion.js");
    const service = new BookIngestionService();

    const mdContent = "# Test Book\n\nThis is a test markdown file.\n\n## Chapter 1\n\nSome content here.";
    const buffer = Buffer.from(mdContent, "utf-8");

    const result = await service.addBook(buffer, "test-book.md", {
      title: "Test Markdown Book",
      author: "Test Author",
    });

    expect(result.status).toBe("ready");
    expect(result.hasMarkdown).toBe(true);
    expect(result.progress).toBe(100);
    expect(result.source).toBe("upload");
    expect(result.title).toBe("Test Markdown Book");

    // Verify the source was inserted in DB as ready
    const db = getDb();
    const row = db.select().from(sources).where(eq(sources.id, result.id)).get();
    expect(row).toBeDefined();
    expect(row!.status).toBe("ready");

    // Verify markdown file exists
    const { existsSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    const mdPath = pathJoin(TEST_DATA_PATH, "sources", result.id, "markdown", "content.md");
    expect(existsSync(mdPath)).toBe(true);

    // Clean up
    await app.request(`/api/library/sources/${result.id}`, { method: "DELETE" });
  });
});

// ── Content Path Resolution ────────────────────────────────────────────────

describe("Content Path Resolution", () => {
  it("absolute contentPath copies file to sources/{id}/markdown/", async () => {
    // Create a temp markdown file
    const { writeFileSync, existsSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");

    const tempFile = pathJoin(TEST_ROOT, "my-notes.md");
    writeFileSync(tempFile, "# My Notes\n\nSome content here.");

    const res = await app.request(
      "/api/library/sources/create",
      json({ title: "Notes Test", type: "custom", contentPath: tempFile }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hasMarkdown).toBe(true);

    // Verify file was copied to sources/{id}/markdown/content.md
    const copiedPath = pathJoin(TEST_DATA_PATH, "sources", body.id, "markdown", "content.md");
    expect(existsSync(copiedPath)).toBe(true);

    // Clean up
    await app.request(`/api/library/sources/${body.id}`, { method: "DELETE" });
  });

  it("relative contentPath resolves from DATA_PATH", async () => {
    const { writeFileSync, mkdirSync: mkdirS, existsSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");

    // Write a file relative to DATA_PATH
    const relDir = pathJoin(TEST_DATA_PATH, "my-content");
    mkdirS(relDir, { recursive: true });
    writeFileSync(pathJoin(relDir, "tutorial.md"), "# Tutorial\n\nLearn things.");

    const res = await app.request(
      "/api/library/sources/create",
      json({ title: "Relative Test", type: "tutorial", contentPath: "my-content/tutorial.md" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hasMarkdown).toBe(true);

    const copiedPath = pathJoin(TEST_DATA_PATH, "sources", body.id, "markdown", "content.md");
    expect(existsSync(copiedPath)).toBe(true);

    await app.request(`/api/library/sources/${body.id}`, { method: "DELETE" });
  });

  it("non-existent contentPath still creates source (graceful)", async () => {
    const res = await app.request(
      "/api/library/sources/create",
      json({ title: "Missing Path", type: "custom", contentPath: "/nonexistent/file.md" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hasMarkdown).toBe(false);

    await app.request(`/api/library/sources/${body.id}`, { method: "DELETE" });
  });
});
