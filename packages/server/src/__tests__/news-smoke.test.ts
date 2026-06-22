/**
 * News API smoke tests — verify feed management and report endpoints.
 *
 * Since the news routes are now plugin-provided (mounted at bootstrap time),
 * this test manually calls the news plugin's setup() to mount routes on the app.
 *
 * Intentionally SKIPS routes that trigger real RSS crawling (POST /crawl)
 * since that would make external network requests.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Stub env vars BEFORE importing app/config so they pick up test paths.
const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-news-test-"));
const TEST_DATA_PATH = join(TEST_ROOT, "data");

vi.stubEnv("DATA_PATH", TEST_DATA_PATH);

// Now safe to import — modules will read our stubbed env vars.
const { app } = await import("../app.js");
const { resetDb, getDb, sources } = await import("../db/index.js");
const { resetServerConfig } = await import("../config.js");
const { SourceServiceImpl } = await import("../services/source-service.js");

// Import the news plugin setup — resolve package path directly
const { createRequire } = await import("node:module");
const { dirname, join: pJoin } = await import("node:path");
const req = createRequire(import.meta.url);
const newsPluginDir = dirname(req.resolve("pi-tree-news/package.json"));
const { setup } = await import(pJoin(newsPluginDir, "routes.ts"));
const { resetNewsDb } = await import(pJoin(newsPluginDir, "db.ts"));

// ── Test isolation ──────────────────────────────────────────────────────────

let newsCleanup: (() => void) | undefined;

beforeAll(() => {
  mkdirSync(TEST_DATA_PATH, { recursive: true });
  mkdirSync(join(TEST_DATA_PATH, "library"), { recursive: true });
  mkdirSync(join(TEST_DATA_PATH, "sources", "news", "analyses"), { recursive: true });
  mkdirSync(join(TEST_DATA_PATH, "sources", "news", "summaries"), { recursive: true });

  // Mount news plugin routes on the app (mimics what bootstrap does)
  const pluginDataDir = join(TEST_DATA_PATH, "plugins", "news");
  mkdirSync(pluginDataDir, { recursive: true });

  const result = setup({
    dataDir: pluginDataDir,
    dataPath: TEST_DATA_PATH,
    sources: new SourceServiceImpl(getDb, sources),
    sessions: { listForSource: () => [], create: () => ({} as any), resolveUserId: () => undefined, getById: () => null },
    users: { get: () => null, ensureExists: (id: string) => ({ id, displayName: id }) },
    registry: { getProfiles: () => new Map(), getSourceTypes: () => [], resolveProfile: () => ({ skills: [], extensions: [] }) },
    config: {},
  });

  app.route("/api/news", result.routes);
  newsCleanup = result.cleanup;
});

afterAll(() => {
  if (newsCleanup) newsCleanup();
  resetNewsDb();
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

// ── Feed Management ─────────────────────────────────────────────────────────

describe("News Feeds CRUD", () => {
  it("GET /api/news/feeds → 200 + returns seeded default feeds", async () => {
    const res = await app.request("/api/news/feeds");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Default feeds are seeded at setup time
    expect(body.length).toBeGreaterThan(0);
  });

  it("POST /api/news/feeds → 200 + creates feed", async () => {
    const res = await app.request(
      "/api/news/feeds",
      json({
        id: "test-feed",
        name: "Test Feed",
        url: "https://example.com/rss",
        tags: ["test", "ci"],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.feed.id).toBe("test-feed");
    expect(body.feed.name).toBe("Test Feed");
  });

  it("POST /api/news/feeds → 400 (duplicate ID)", async () => {
    const res = await app.request(
      "/api/news/feeds",
      json({
        id: "test-feed",
        name: "Duplicate",
        url: "https://example.com/rss2",
        tags: [],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("already exists");
  });

  it("POST /api/news/feeds → 400 (missing required fields)", async () => {
    const res = await app.request(
      "/api/news/feeds",
      json({ name: "No ID" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Missing required fields");
  });

  it("GET /api/news/feeds → 200 + includes new feed after creation", async () => {
    const res = await app.request("/api/news/feeds");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should contain the seeded defaults plus our test-feed
    expect(body.some((f: any) => f.id === "test-feed")).toBe(true);
  });

  it("POST /api/news/feeds → creates a second feed", async () => {
    const res = await app.request(
      "/api/news/feeds",
      json({
        id: "second-feed",
        name: "Second Feed",
        url: "https://example.com/rss3",
        tags: ["news"],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("DELETE /api/news/feeds/:id → 200 (remove feed)", async () => {
    const res = await app.request("/api/news/feeds/second-feed", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("DELETE /api/news/feeds/:id → 404 (nonexistent feed)", async () => {
    const res = await app.request("/api/news/feeds/nonexistent", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

// ── Aggregation ─────────────────────────────────────────────────────────────

describe("News Aggregation", () => {
  it("GET /api/news/aggregate → 200 + empty groups (no items yet)", async () => {
    const res = await app.request("/api/news/aggregate");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /api/news/aggregate?days=7&limit=10 → 200 with query params", async () => {
    const res = await app.request("/api/news/aggregate?days=7&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ── Reports ─────────────────────────────────────────────────────────────────

describe("News Reports", () => {
  it("GET /api/news/reports → 200 + empty lists initially", async () => {
    const res = await app.request("/api/news/reports");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("analyses");
    expect(body).toHaveProperty("summaries");
    expect(body.analyses).toEqual([]);
    expect(body.summaries).toEqual([]);
  });

  it("GET /api/news/reports → 200 + lists existing report files", async () => {
    // Create a test report file
    writeFileSync(
      join(TEST_DATA_PATH, "sources", "news", "analyses", "test-report.md"),
      "# Test Report\n\nSome analysis content.",
    );

    const res = await app.request("/api/news/reports");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analyses).toContain("test-report.md");
  });

  it("GET /api/news/reports/analyses/test-report.md → 200 + content", async () => {
    const res = await app.request("/api/news/reports/analyses/test-report.md");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.content).toContain("# Test Report");
  });

  it("GET /api/news/reports/analyses/nonexistent.md → 404", async () => {
    const res = await app.request("/api/news/reports/analyses/nonexistent.md");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("GET /api/news/reports/invalid-type/test.md → 400", async () => {
    const res = await app.request("/api/news/reports/invalid-type/test.md");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid report type");
  });

  it("GET /api/news/reports/analyses/../../etc/passwd → 400 (path traversal)", async () => {
    const res = await app.request("/api/news/reports/analyses/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("GET /api/news/reports/analyses/noext → 400 (no .md extension)", async () => {
    const res = await app.request("/api/news/reports/analyses/noext");
    expect(res.status).toBe(400);
  });
});
