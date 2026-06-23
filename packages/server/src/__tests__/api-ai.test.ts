import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useAimock } from "@copilotkit/aimock/vitest";

// Stub env vars BEFORE importing app/config so they pick up test paths.
const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-ai-test-"));
const TEST_DATA_PATH = join(TEST_ROOT, "data");

vi.stubEnv("DATA_PATH", TEST_DATA_PATH);
vi.stubEnv("PI_MODEL", "mock-model");
vi.stubEnv("PI_PROVIDER", "openai");
vi.stubEnv("PI_API_KEY", "mock-key");
vi.stubEnv("PI_API", "openai-completions");
vi.stubEnv("PI_API_TYPE", "openai-completions");

// Initialize aimock
const mock = useAimock({
  patchEnv: true,
  strict: true,
  logLevel: "info",
});

// Now safe to import — modules will read our stubbed env vars.
const { app } = await import("../app.js");
const { resetDb, getDb, sources } = await import("../db/index.js");
const { resetServerConfig } = await import("../config.js");

function json(data: Record<string, unknown>) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

describe("API LLM Integration via aimock", () => {
  const userId = "ai-test-user";
  const sourceId = "ai-test-source";
  let sessionId: number;

  beforeAll(async () => {
    // Point PI_BASE_URL to the aimock URL
    vi.stubEnv("PI_BASE_URL", `${mock().url}/v1`);

    // Initialize agent registry for profile resolution
    const { initAgentRegistry } = await import("../services/agent-registry.js");
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

    // Initialize extension services context
    const { setExtensionServices } = await import("../agents/context.js");
    const { userSessions, users } = await import("../db/index.js");
    setExtensionServices({
      db: getDb,
      schema: { sources, userSessions, users },
      getPluginDataDir: () => join(TEST_DATA_PATH, "plugins"),
    } as any);

    mkdirSync(TEST_DATA_PATH, { recursive: true });
    
    // Create source folders
    const sourceDir = join(TEST_DATA_PATH, "sources", sourceId);
    const sourceMarkdownDir = join(sourceDir, "markdown");
    mkdirSync(sourceMarkdownDir, { recursive: true });
    writeFileSync(join(sourceMarkdownDir, "content.md"), "# Test Source\n\nContent here.");

    // Create a user in the DB
    await app.request("/api/users", json({ id: userId, displayName: "AI Tester" }));

    // Create the source in the DB
    const db = getDb();
    const now = new Date().toISOString();
    db.insert(sources)
      .values({
        id: sourceId,
        type: "book",
        title: "Test AI Book",
        author: "AI Author",
        source: "library",
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    // Create a session so resolveProfile gets mode: "reading" → "book.reading"
    const sessRes = await app.request(
      `/api/sessions/${userId}/${sourceId}`,
      json({ title: "AI Test Session", context: { mode: "reading" } }),
    );
    sessionId = (await sessRes.json()).id;
  });

  afterAll(async () => {
    resetDb();
    resetServerConfig();
    vi.unstubAllEnvs();
    try {
      rmSync(TEST_ROOT, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  it("POST /api/session/message → 200 with LLM response", async () => {
    // 1. Add fixture to aimock
    mock().llm.addFixture({
      match: {
        model: "mock-model",
        userMessage: "hello",
      },
      response: {
        content: "Hello from aimock! I am a simulated response.",
      },
    });

    // 2. Start session
    const startRes = await app.request(
      "/api/session/start",
      json({ userId, sourceId, sessionId }),
    );
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json();
    expect(startBody).toHaveProperty("viewNodeId");

    // 3. Send message
    const msgRes = await app.request(
      "/api/session/message",
      json({
        userId,
        sourceId,
        sessionId,
        message: "hello",
        viewNodeId: startBody.viewNodeId,
      }),
    );
    expect(msgRes.status).toBe(200);
    const msgBody = await msgRes.json();
    
    // Check that we got the mock response back
    expect(msgBody.response).toBe("Hello from aimock! I am a simulated response.");
    
    // Check that the conversation now contains our messages
    expect(msgBody.messages).toBeDefined();
    expect(msgBody.messages.length).toBeGreaterThan(0);
    
    const lastMsg = msgBody.messages[msgBody.messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.content).toBe("Hello from aimock! I am a simulated response.");
  });

  it("POST /api/session/message/stream → 200 with streamed SSE chunks", async () => {
    // 1. Add fixture to aimock
    mock().llm.addFixture({
      match: {
        model: "mock-model",
        userMessage: "stream-me",
      },
      response: {
        content: "Streaming response from aimock!",
      },
    });

    // 2. Start session
    const startRes = await app.request(
      "/api/session/start",
      json({ userId, sourceId, sessionId }),
    );
    const startBody = await startRes.json();

    // 3. Request the stream endpoint
    const streamRes = await app.request(
      "/api/session/message/stream",
      json({
        userId,
        sourceId,
        sessionId,
        message: "stream-me",
        viewNodeId: startBody.viewNodeId,
      }),
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("Content-Type")).toContain("text/event-stream");

    // 4. Read the stream body
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let streamText = "";
    
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        streamText += decoder.decode(value);
      }
    }

    // 5. Parse the events
    const lines = streamText.split("\n\n").filter(Boolean);
    const events = lines.map((l) => {
      const match = l.match(/^data:\s*(.+)$/m);
      if (!match) return null;
      return JSON.parse(match[1]);
    }).filter(Boolean);

    // No lock contention in a single-request test → no queued event
    expect(events.some((e) => e.type === "queued")).toBe(false);
    
    const tokens = events
      .filter((e) => e.type === "token")
      .map((e) => e.token)
      .join("");
    expect(tokens).toBe("Streaming response from aimock!");

    expect(events.some((e) => e.type === "turn_end")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
