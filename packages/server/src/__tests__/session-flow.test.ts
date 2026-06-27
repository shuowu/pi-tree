/**
 * Session flow integration test — the full session lifecycle.
 *
 * Covers routes that api-smoke.test.ts explicitly skips (anything that
 * touches PiSession / LLM), and routes that api-ai.test.ts doesn't reach
 * (tree, breadcrumb, view, fork, navigate, rename-node, delete-node, close).
 *
 * Uses aimock for deterministic LLM responses, in-process app.request().
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useAimock } from "@copilotkit/aimock/vitest";

// ── Env stubs (before any app import) ──────────────────────────────────────

const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-session-flow-"));
const TEST_DATA_PATH = join(TEST_ROOT, "data");

vi.stubEnv("DATA_PATH", TEST_DATA_PATH);
vi.stubEnv("PI_MODEL", "mock-model");
vi.stubEnv("PI_PROVIDER", "openai");
vi.stubEnv("PI_API_KEY", "mock-key");
vi.stubEnv("PI_API", "openai-completions");
vi.stubEnv("PI_API_TYPE", "openai-completions");

const mock = useAimock({
  patchEnv: true,
  strict: true,
  logLevel: "info",
});

const { app } = await import("../app.js");
const { resetDb, getDb, sources } = await import("../db/index.js");
const { resetServerConfig } = await import("../config.js");

// ── Helpers ────────────────────────────────────────────────────────────────

function json(data: Record<string, unknown>) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

const userId = "session-flow-user";
const sourceId = "session-flow-source";

describe("Session flow — full lifecycle", () => {
  beforeAll(async () => {
    vi.stubEnv("PI_BASE_URL", `${mock().url}/v1`);

    const { initAgentRegistry } = await import(
      "../services/agent-registry.js"
    );
    const { createRequire } = await import("node:module");
    const { dirname } = await import("node:path");
    const req = createRequire(import.meta.url);
    const corePluginDirs = ["pi-tree-book", "pi-tree-news", "pi-tree-paper", "pi-tree-youtube", "pi-tree-mcp"].flatMap(pkg => {
      try { return [dirname(req.resolve(`${pkg}/package.json`))]; }
      catch { return []; }
    });
    initAgentRegistry({
      coreDir: join(import.meta.dirname, ".."),
      dataDir: TEST_DATA_PATH,
      corePluginDirs,
    });

    const { setExtensionServices } = await import("../agents/context.js");
    const { userSessions, users } = await import("../db/index.js");
    setExtensionServices({
      db: getDb,
      schema: { sources, userSessions, users },
      getPluginDataDir: () => join(TEST_DATA_PATH, "plugins"),
    } as any);

    mkdirSync(TEST_DATA_PATH, { recursive: true });

    // Source content on disk
    const mdDir = join(TEST_DATA_PATH, "sources", sourceId, "markdown");
    mkdirSync(mdDir, { recursive: true });
    writeFileSync(
      join(mdDir, "content.md"),
      "# Test Book\n\n## Chapter 1\n\nSome content.\n\n## Chapter 2\n\nMore content.",
    );

    // User + source in DB
    await app.request("/api/users", json({ id: userId, displayName: "Flow Tester" }));
    const db = await getDb();
    const now = new Date().toISOString();
    await db.insert(sources)
      .values({
        id: sourceId,
        type: "book",
        title: "Session Flow Book",
        author: "Test Author",
        source: "library",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // Default aimock fixture — matches any message for our model
    mock().llm.addFixture({
      match: { model: "mock-model" },
      response: { content: "Mock AI response." },
    });

    // Create a session so resolveProfile gets mode: "reading" → "book.reading"
    const sessRes = await app.request(
      `/api/sessions/${userId}/${sourceId}`,
      json({ title: "Flow Test Session", context: { mode: "reading" } }),
    );
    sessionId = (await sessRes.json()).id;
  });

  afterAll(() => {
    resetDb();
    resetServerConfig();
    vi.unstubAllEnvs();
    try {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  });

  // ── 1. Start session ──────────────────────────────────────────────────

  let viewNodeId: string;
  let sessionId: number;

  it("POST /session/start → 200 with session state", async () => {
    const res = await app.request(
      "/api/session/start",
      json({ userId, sourceId, sessionId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("viewNodeId");
    expect(body).toHaveProperty("tree");
    expect(body).toHaveProperty("messages");
    viewNodeId = body.viewNodeId;
  });

  // ── 2. Send a message → AI responds ───────────────────────────────────

  let afterMsgNodeId: string;

  it("POST /session/message → 200 with AI response + updated tree", async () => {
    const res = await app.request(
      "/api/session/message",
      json({ userId, sourceId, sessionId, message: "hello", viewNodeId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.response).toBe("Mock AI response.");
    expect(body.messages.length).toBeGreaterThan(0);

    // viewNodeId should have advanced
    expect(body.viewNodeId).toBeDefined();
    afterMsgNodeId = body.viewNodeId;
  });

  // ── 3. Get tree ───────────────────────────────────────────────────────

  it("GET /session/tree/:userId/:sourceId → 200 with tree nodes", async () => {
    const res = await app.request(
      `/api/session/tree/${userId}/${sourceId}?sessionId=${sessionId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // getTreeView returns a single root TreeNodeView with children
    expect(body).toHaveProperty("id");
    expect(body).toHaveProperty("children");
    expect(Array.isArray(body.children)).toBe(true);
  });

  // ── 4. Get breadcrumb ─────────────────────────────────────────────────

  it("GET /session/breadcrumb/:userId/:sourceId → 200 with breadcrumb", async () => {
    const res = await app.request(
      `/api/session/breadcrumb/${userId}/${sourceId}?sessionId=${sessionId}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("breadcrumb");
    expect(Array.isArray(body.breadcrumb)).toBe(true);
  });

  // ── 5. View a specific scope ──────────────────────────────────────────

  it("POST /session/view → 200 with scoped messages", async () => {
    const res = await app.request(
      "/api/session/view",
      json({ userId, sourceId, sessionId, viewNodeId: afterMsgNodeId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("messages");
    expect(body).toHaveProperty("viewNodeId");
    expect(body.messages.length).toBeGreaterThan(0);
  });

  // ── 6. Send a second message to build tree depth ──────────────────────

  let secondMsgNodeId: string;

  it("POST /session/message (2nd) → grows the tree", async () => {
    const res = await app.request(
      "/api/session/message",
      json({
        userId,
        sourceId,
        sessionId,
        message: "tell me more",
        viewNodeId: afterMsgNodeId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBe("Mock AI response.");
    // Linear continuation may keep the same scope viewNodeId
    secondMsgNodeId = body.viewNodeId ?? afterMsgNodeId;
    // Tree should have grown — more messages than after the first send
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
  });

  // ── 7. Fork ───────────────────────────────────────────────────────────

  it("POST /session/fork → 200 creates a branch", async () => {
    const res = await app.request(
      "/api/session/fork",
      json({ userId, sourceId, sessionId, viewNodeId: afterMsgNodeId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // forkAtNode returns { state: SessionState, forkScopeId }
    expect(body).toHaveProperty("state");
    expect(body.state).toHaveProperty("viewNodeId");
    expect(body.state).toHaveProperty("tree");
    expect(body).toHaveProperty("forkScopeId");
  });

  // ── 8. Rename a node ──────────────────────────────────────────────────

  it("POST /session/rename-node → 200 renames", async () => {
    const res = await app.request(
      "/api/session/rename-node",
      json({
        userId,
        sourceId,
        sessionId,
        nodeId: afterMsgNodeId,
        newLabel: "Renamed Node",
        viewNodeId: afterMsgNodeId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tree");
  });

  // ── 9. Delete a node ──────────────────────────────────────────────────

  it("POST /session/delete-node → 200 soft-deletes", async () => {
    const res = await app.request(
      "/api/session/delete-node",
      json({
        userId,
        sourceId,
        sessionId,
        nodeId: secondMsgNodeId,
        viewNodeId: afterMsgNodeId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tree");
  });

  // ── 10. Close session ─────────────────────────────────────────────────

  it("POST /session/close → 200", async () => {
    const res = await app.request(
      "/api/session/close",
      json({ userId, sourceId, sessionId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // ── 11. Reset session ─────────────────────────────────────────────────

  it("POST /session/reset → 200 clears session", async () => {
    // Re-start so there's a session to reset
    await app.request("/api/session/start", json({ userId, sourceId, sessionId }));

    const res = await app.request(
      "/api/session/reset",
      json({ userId, sourceId, sessionId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
