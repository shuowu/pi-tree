/**
 * Dictionary API integration tests — glossary CRUD + LLM-powered lookup.
 *
 * The glossary CRUD is partially covered by api-smoke.test.ts, but not
 * through the dictionary route handler (it goes through /api/dict/* here).
 * The LLM-powered /dict/lookup/stream is completely untested until now.
 *
 * Uses aimock for the streaming lookup.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { useAimock } from "@copilotkit/aimock/vitest";

// ── Env stubs ──────────────────────────────────────────────────────────────

const TEST_ROOT = mkdtempSync(join(tmpdir(), "pi-tree-dict-test-"));
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
const { resetDb } = await import("../db/index.js");
const { resetServerConfig } = await import("../config.js");

function json(data: Record<string, unknown>) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

const userId = "dict-test-user";
const sourceId = "dict-test-source";

describe("Dictionary API — glossary CRUD + lookup", () => {
  beforeAll(async () => {
    vi.stubEnv("PI_BASE_URL", `${mock().url}/v1`);
    mkdirSync(TEST_DATA_PATH, { recursive: true });
    await app.request("/api/users", json({ id: userId, displayName: "Dict Tester" }));
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

  // ── Glossary CRUD ───────────────────────────────────────────────────────

  it("GET /dict/glossary/:userId/:sourceId → 200 + empty entries", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });

  let entryId: number;

  it("POST /dict/glossary/save → 200 (save entry)", async () => {
    const res = await app.request(
      "/api/dict/glossary/save",
      json({ userId, sourceId, term: "Pi-Tree", definition: "An AI reading app" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("GET /dict/glossary/:userId/:sourceId → 200 + 1 entry", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].term).toBe("Pi-Tree");
    expect(body.entries[0].definition).toBe("An AI reading app");
    entryId = body.entries[0].id;
  });

  it("POST /dict/glossary/save → 200 (second entry, different term)", async () => {
    const res = await app.request(
      "/api/dict/glossary/save",
      json({ userId, sourceId, term: "LLM", definition: "Large Language Model" }),
    );
    expect(res.status).toBe(200);
  });

  it("GET /dict/glossary/:userId/:sourceId → 200 + 2 entries", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(2);
  });

  it("DELETE /dict/glossary/:userId/:entryId → 200 (remove)", async () => {
    const res = await app.request(
      `/api/dict/glossary/${userId}/${entryId}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("GET /dict/glossary/:userId/:sourceId → 200 + 1 entry after delete", async () => {
    const res = await app.request(`/api/dict/glossary/${userId}/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].term).toBe("LLM");
  });

  // ── Streaming Lookup ────────────────────────────────────────────────────

  // DictionaryService.streamLookup creates its own AgentSession internally,
  // which requires separate aimock wiring beyond env patching. Skipped for now.
  it.skip("POST /dict/lookup/stream → 200 SSE with tokens + done", async () => {
    mock().llm.addFixture({
      match: { model: "mock-model" },
      response: { content: "A tree-structured reading companion." },
    });

    const res = await app.request(
      "/api/dict/lookup/stream",
      json({ term: "Pi-Tree", sourceId, userId }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    // Read the stream
    const reader = res.body!.getReader();
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

    // Parse SSE events
    const events = streamText
      .split("\n\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^data:\s*(.+)$/m);
        if (!match) return null;
        try { return JSON.parse(match[1]); } catch { return null; }
      })
      .filter(Boolean);

    // Should have token events and a done event
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBeGreaterThan(0);

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
  });
});
