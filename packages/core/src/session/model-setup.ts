/**
 * Model registry configuration — extracted from PiSession.create() for testability.
 *
 * Handles: auth setup, provider registration, API type overrides.
 * Strict: only selects models under the configured provider — never falls back
 * to a random SDK provider. Custom models (from models.json) are auto-registered.
 */

import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { PiSessionConfig } from "./pi-session.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ModelSetupResult {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  selectedModel: ReturnType<ModelRegistry["getAll"]>[number] | undefined;
}

/**
 * Configure auth, model registry, and provider overrides.
 *
 * Pure setup — no file I/O, no session creation. The resulting
 * `authStorage` and `modelRegistry` can be passed directly to
 * `createAgentSession()`.
 */
export function configureModelRegistry(
  config: PiSessionConfig,
): ModelSetupResult {
  // In-memory auth — no file I/O, keys set programmatically.
  const authStorage = AuthStorage.inMemory();
  if (config.apiKey && config.provider) {
    authStorage.setRuntimeApiKey(config.provider, config.apiKey);
  }

  // In-memory model registry — loads SDK built-in models, skips ~/.pi/agent/models.json.
  const modelRegistry = ModelRegistry.inMemory(authStorage);

  // Register the configured provider (base URL + API type + models).
  if (config.provider && config.baseUrl) {
    registerProviderWithModels(modelRegistry, config.provider, config);
  }

  // Select the model by ID — must exist under the configured provider.
  // The SDK registry has the same model under many providers; we never
  // fall back to a random one — that causes auth mismatches.
  let selectedModel = config.provider
    ? modelRegistry.getAll().find((m) => m.id === config.readingModel && m.provider === config.provider)
    : modelRegistry.getAll().find((m) => m.id === config.readingModel);

  // If not found, the model may be a custom one from models.json that doesn't
  // exist in the SDK's built-in registry. Register it as a minimal model
  // under the configured provider so the session can use it.
  if (!selectedModel && config.readingModel && config.provider && config.baseUrl) {
    const apiType = config.api || "openai-completions";
    modelRegistry.registerProvider(config.provider, {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      api: apiType as any,
      models: [{
        id: config.readingModel,
        name: config.readingModel,
        api: apiType as any,
        reasoning: false,
        input: ["text"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        ...(config.compat ? { compat: config.compat } : {}),
      }],
    });
    selectedModel = modelRegistry.getAll().find(
      (m) => m.id === config.readingModel && m.provider === config.provider,
    );
  }

  if (config.readingModel && !selectedModel) {
    throw new Error(
      `Model "${config.readingModel}" not found under provider "${config.provider}". ` +
      `Check your models.json or PI_MODEL / PI_PROVIDER configuration.`,
    );
  }

  return { authStorage, modelRegistry, selectedModel };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Register a provider with base URL, API key, and (if apiType is set)
 * re-register all its models with the overridden API type.
 *
 * `registerProvider()` alone only updates the provider's URL — it does NOT
 * change each model's individual `api` field. When overriding the API type
 * (e.g., from `openai-completions` to `anthropic-messages`), we must
 * explicitly re-register the models array.
 */
function registerProviderWithModels(
  registry: ModelRegistry,
  provider: string,
  config: PiSessionConfig,
): void {
  const apiType = config.api || undefined;

  if (apiType) {
    const existingModels = registry
      .getAll()
      .filter((m) => m.provider === provider);

    const modelsConfig = existingModels.map(
      (m) => ({
        id: m.id,
        name: m.name ?? m.id,
        api: apiType as any,
        reasoning: m.reasoning ?? false,
        input: (m.input ?? ["text"]) as ("text" | "image")[],
        cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.contextWindow ?? 200000,
        maxTokens: m.maxTokens ?? 16384,
        ...(config.compat ? { compat: config.compat } : {}),
      }),
    );

    registry.registerProvider(provider, {
      baseUrl: config.baseUrl,
      api: apiType as any,
      apiKey: config.apiKey,
      models: modelsConfig.length > 0 ? modelsConfig : undefined,
    });
  } else {
    registry.registerProvider(provider, {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
    });
  }
}
