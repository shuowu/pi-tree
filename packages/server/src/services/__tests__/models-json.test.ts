import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadModelsJson,
  resolveApiKey,
  findProviderForModel,
  resetModelsJsonCache,
} from "../models-json.js";

const TEST_ROOT = mkdtempSync(join(tmpdir(), "models-json-test-"));

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(() => {
  resetModelsJsonCache();
});

// ---------------------------------------------------------------------------
// loadModelsJson
// ---------------------------------------------------------------------------

describe("loadModelsJson", () => {
  it("returns null when file does not exist", () => {
    const empty = join(TEST_ROOT, "no-such-dir");
    mkdirSync(empty, { recursive: true });
    vi.stubEnv("DATA_PATH", empty);

    expect(loadModelsJson()).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const dir = join(TEST_ROOT, "invalid-json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "models.json"), "not valid json {{{");
    vi.stubEnv("DATA_PATH", dir);

    expect(loadModelsJson()).toBeNull();
  });

  it("parses valid config with providers", () => {
    const dir = join(TEST_ROOT, "valid");
    mkdirSync(dir, { recursive: true });
    const config = {
      providers: {
        lmstudio: {
          baseUrl: "http://localhost:1234/v1",
          api: "openai-completions",
          apiKey: "lmstudio",
          models: [{ id: "qwen/qwen3.6-27b" }],
        },
      },
    };
    writeFileSync(join(dir, "models.json"), JSON.stringify(config));
    vi.stubEnv("DATA_PATH", dir);

    const result = loadModelsJson();
    expect(result).toEqual(config);
    expect(result!.providers!.lmstudio.models).toHaveLength(1);
    expect(result!.providers!.lmstudio.models![0].id).toBe("qwen/qwen3.6-27b");
  });

  it("returns cached result on second call (same DATA_PATH)", () => {
    const dir = join(TEST_ROOT, "cached");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({ providers: { a: { models: [{ id: "m1" }] } } }),
    );
    vi.stubEnv("DATA_PATH", dir);

    const first = loadModelsJson();
    const second = loadModelsJson();
    expect(first).toBe(second); // same reference = cache hit
  });

  it("parses config with empty providers", () => {
    const dir = join(TEST_ROOT, "empty-providers");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: {} }));
    vi.stubEnv("DATA_PATH", dir);

    const result = loadModelsJson();
    expect(result).toEqual({ providers: {} });
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey
// ---------------------------------------------------------------------------

describe("resolveApiKey", () => {
  it("returns undefined for undefined input", () => {
    expect(resolveApiKey(undefined)).toBeUndefined();
  });

  it("returns literal string as-is", () => {
    expect(resolveApiKey("sk-1234")).toBe("sk-1234");
  });

  it("resolves $ENV_VAR syntax from process.env", () => {
    vi.stubEnv("MY_TEST_KEY", "resolved-secret");
    expect(resolveApiKey("$MY_TEST_KEY")).toBe("resolved-secret");
  });

  it("returns raw string when env var is not set", () => {
    delete process.env.NONEXISTENT_VAR_12345;
    expect(resolveApiKey("$NONEXISTENT_VAR_12345")).toBe(
      "$NONEXISTENT_VAR_12345",
    );
  });

  it("returns empty string as undefined", () => {
    expect(resolveApiKey("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findProviderForModel
// ---------------------------------------------------------------------------

describe("findProviderForModel", () => {
  it("returns null when no models.json exists", () => {
    const dir = join(TEST_ROOT, "find-missing");
    mkdirSync(dir, { recursive: true });
    vi.stubEnv("DATA_PATH", dir);

    expect(findProviderForModel("any-model")).toBeNull();
  });

  it("returns null when model is not in any provider", () => {
    const dir = join(TEST_ROOT, "find-no-match");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          openai: {
            apiKey: "sk-test",
            models: [{ id: "gpt-4o" }],
          },
        },
      }),
    );
    vi.stubEnv("DATA_PATH", dir);

    expect(findProviderForModel("claude-sonnet")).toBeNull();
  });

  it("finds the provider that owns a model", () => {
    const dir = join(TEST_ROOT, "find-match");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.com",
            apiKey: "$ANTHROPIC_KEY",
            models: [{ id: "claude-sonnet" }, { id: "claude-haiku" }],
          },
          openai: {
            apiKey: "sk-test",
            models: [{ id: "gpt-4o" }],
          },
        },
      }),
    );
    vi.stubEnv("DATA_PATH", dir);

    const result = findProviderForModel("gpt-4o");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("openai");
    expect(result!.config.apiKey).toBe("sk-test");
  });

  it("matches first provider when model appears in multiple", () => {
    const dir = join(TEST_ROOT, "find-first");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          provider_a: { models: [{ id: "shared-model" }] },
          provider_b: { models: [{ id: "shared-model" }] },
        },
      }),
    );
    vi.stubEnv("DATA_PATH", dir);

    const result = findProviderForModel("shared-model");
    expect(result!.name).toBe("provider_a");
  });

  it("returns null when provider has no models array", () => {
    const dir = join(TEST_ROOT, "find-no-models-arr");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          bare: { baseUrl: "http://localhost:1234" },
        },
      }),
    );
    vi.stubEnv("DATA_PATH", dir);

    expect(findProviderForModel("anything")).toBeNull();
  });
});
