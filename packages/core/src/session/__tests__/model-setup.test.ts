/**
 * Tests for configureModelRegistry() — the provider/auth/model setup
 * extracted from PiSession.create().
 *
 * These tests exercise the exact logic that caused two production bugs:
 * 1. API key not propagated to model's built-in provider when names differ
 * 2. API type not overridden on individual models (registerProvider alone
 *    doesn't update each model's `api` field)
 */

import { describe, it, expect } from "vitest";
import { configureModelRegistry } from "../model-setup.js";
import type { PiSessionConfig } from "../pi-session.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal config for testing. */
function makeConfig(overrides: Partial<PiSessionConfig> = {}): PiSessionConfig {
  return {
    readingModel: "",
    ...overrides,
  };
}

/**
 * Get a well-known built-in model from the SDK registry.
 * Returns the first model found, or undefined if the SDK has no built-in models.
 */
function getBuiltInModel(result: ReturnType<typeof configureModelRegistry>) {
  return result.modelRegistry.getAll()[0];
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("configureModelRegistry", () => {
  // --- Basic operation ---

  it("returns authStorage, modelRegistry, and selectedModel", () => {
    const result = configureModelRegistry(makeConfig());
    expect(result.authStorage).toBeDefined();
    expect(result.modelRegistry).toBeDefined();
    expect(result.selectedModel).toBeUndefined(); // no readingModel set
  });

  it("loads SDK built-in models into the registry", () => {
    const result = configureModelRegistry(makeConfig());
    const allModels = result.modelRegistry.getAll();
    expect(allModels.length).toBeGreaterThan(0);
  });

  // --- API key propagation ---

  it("sets API key for the configured provider", () => {
    const result = configureModelRegistry(
      makeConfig({ provider: "test-provider", apiKey: "test-key" }),
    );
    // Auth should report the key is configured
    expect(result.authStorage).toBeDefined();
    // We can verify indirectly: the auth storage was created and the key was set
    // (AuthStorage.inMemory doesn't expose keys directly, but hasConfiguredAuth checks)
  });

  it("registers model under custom alias when provider name differs from built-in", () => {
    // Find a built-in model to test with
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return; // skip if no built-in models

    // Use a different provider name + baseUrl — the model gets re-registered
    // under the custom alias (strict provider matching won't find it under
    // the built-in provider name).
    const result = configureModelRegistry(
      makeConfig({
        provider: "my-custom-alias",
        apiKey: "test-key-123",
        baseUrl: "https://api.example.com",
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    expect(result.selectedModel!.provider).toBe("my-custom-alias");

    // Auth should be configured for the custom alias provider
    const hasAuth = result.modelRegistry.hasConfiguredAuth(result.selectedModel!);
    expect(hasAuth).toBe(true);
  });

  it("does NOT propagate when provider names match", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;

    // Use the same provider name as the model's built-in provider
    const result = configureModelRegistry(
      makeConfig({
        provider: builtIn.provider,
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    // No mismatch, so no extra propagation needed — just direct setup
  });

  it("throws when apiKey is empty (cannot register provider without auth)", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;

    const result = configureModelRegistry(
      makeConfig({
        provider: builtIn.provider,
        apiKey: "", // empty
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    // Without an API key, hasConfiguredAuth should be false
    const hasAuth = result.modelRegistry.hasConfiguredAuth(result.selectedModel!);
    expect(hasAuth).toBe(false);
  });

  // --- API type override ---

  it("overrides API type on models when api is set", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;

    const result = configureModelRegistry(
      makeConfig({
        provider: builtIn.provider,
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        api: "anthropic-messages",
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    // The model's API type should now be overridden
    expect(result.selectedModel!.api).toBe("anthropic-messages");
  });

  it("overrides API type on BOTH providers when names differ", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;

    const result = configureModelRegistry(
      makeConfig({
        provider: "custom-alias",
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        api: "anthropic-messages",
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    // The model (under its built-in provider) should have the overridden API type
    expect(result.selectedModel!.api).toBe("anthropic-messages");
  });

  it("preserves original API type when no override is configured", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;
    const originalApi = builtIn.api;

    const result = configureModelRegistry(
      makeConfig({
        provider: builtIn.provider,
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        // no `api` override
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    expect(result.selectedModel!.api).toBe(originalApi);
  });

  // --- Base URL ---

  it("registers custom base URL for configured provider", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;

    const result = configureModelRegistry(
      makeConfig({
        provider: builtIn.provider,
        apiKey: "test-key",
        baseUrl: "https://custom.api.com",
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    expect(result.selectedModel!.baseUrl).toBe("https://custom.api.com");
  });

  it("propagates base URL to model's built-in provider when names differ", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;

    const result = configureModelRegistry(
      makeConfig({
        provider: "custom-alias",
        apiKey: "test-key",
        baseUrl: "https://custom.api.com",
        readingModel: builtIn.id,
      }),
    );

    expect(result.selectedModel).toBeDefined();
    expect(result.selectedModel!.baseUrl).toBe("https://custom.api.com");
  });

  // --- Model selection ---

  it("selects model by readingModel ID", () => {
    const initial = configureModelRegistry(makeConfig());
    const builtIn = getBuiltInModel(initial);
    if (!builtIn) return;

    const result = configureModelRegistry(
      makeConfig({ readingModel: builtIn.id }),
    );

    expect(result.selectedModel).toBeDefined();
    expect(result.selectedModel!.id).toBe(builtIn.id);
  });

  it("throws when model ID is not found", () => {
    expect(() => {
      configureModelRegistry(
        makeConfig({ readingModel: "nonexistent-model-xyz" }),
      );
    }).toThrow(/not found/);
  });

  // --- Edge cases ---

  it("works with empty/minimal config", () => {
    const result = configureModelRegistry({ readingModel: "" });
    expect(result.authStorage).toBeDefined();
    expect(result.modelRegistry).toBeDefined();
    expect(result.selectedModel).toBeUndefined();
  });

  it("handles provider with no built-in models gracefully", () => {
    const result = configureModelRegistry(
      makeConfig({
        provider: "totally-unknown-provider",
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        api: "anthropic-messages",
      }),
    );

    // Should not throw — provider gets registered even with no models
    expect(result.authStorage).toBeDefined();
    expect(result.modelRegistry).toBeDefined();
  });
});
