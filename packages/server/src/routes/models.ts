/**
 * Model listing route — returns all registered models from env config
 * and $DATA_PATH/models.json.
 *
 * Mounted at `/api/models`.
 */

import { Hono } from "hono";
import { getServerConfig } from "../config.js";
import { configureModelRegistry } from "@pi-tree/core";
import {
  loadModelsJson,
  resolveApiKey,
} from "../services/models-json.js";

export const modelRoutes = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

modelRoutes.get("/", async (c) => {
  const cfg = getServerConfig();

  // Build a temporary model registry from current server config
  const { modelRegistry } = configureModelRegistry({
    readingModel: cfg.readingModel,
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    api: cfg.api,
  });

  // Load user-defined providers from $DATA_PATH/models.json
  const modelsJson = loadModelsJson();
  const modelsJsonProviders = new Set<string>();

  if (modelsJson?.providers) {
    for (const [name, providerCfg] of Object.entries(modelsJson.providers)) {
      modelsJsonProviders.add(name);

      // Register provider + models into the registry so they appear in getAll()
      const resolvedKey = resolveApiKey(providerCfg.apiKey);
      const modelsConfig = providerCfg.models?.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        api: (providerCfg.api ?? "openai-completions") as any,
        reasoning: m.reasoning ?? false,
        input: (m.input ?? ["text"]) as ("text" | "image")[],
        cost: {
          input: m.cost?.input ?? 0,
          output: m.cost?.output ?? 0,
          cacheRead: m.cost?.cacheRead ?? 0,
          cacheWrite: m.cost?.cacheWrite ?? 0,
        },
        contextWindow: m.contextWindow ?? 128000,
        maxTokens: 16384,
      }));

      modelRegistry.registerProvider(name, {
        baseUrl: providerCfg.baseUrl,
        apiKey: resolvedKey,
        ...(providerCfg.api ? { api: providerCfg.api as any } : {}),
        ...(modelsConfig?.length ? { models: modelsConfig } : {}),
      });
    }
  }

  const allModels = modelRegistry.getAll();

  // Allowed providers: the env-configured provider + all from models.json.
  const allowedProviders = new Set([
    ...(cfg.provider ? [cfg.provider] : []),
    ...modelsJsonProviders,
  ]);

  // Filter to relevant providers + always include the current model
  const filtered = allModels.filter(
    (m) =>
      allowedProviders.has(m.provider) ||
      m.id === cfg.readingModel,
  );

  // Deduplicate by model ID — prefer the configured provider's entry.
  const seen = new Map<string, (typeof filtered)[number]>();
  for (const m of filtered) {
    const existing = seen.get(m.id);
    if (!existing || m.provider === cfg.provider) {
      seen.set(m.id, m);
    }
  }

  const models: ModelInfo[] = [...seen.values()].map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    provider: m.provider,
    reasoning: m.reasoning ?? false,
    contextWindow: m.contextWindow ?? 0,
  }));
  // Build provider source info for the UI
  const providerSources: Array<{ name: string; source: string; modelCount: number }> = [];
  if (cfg.provider) {
    const envModels = models.filter((m) => m.provider === cfg.provider);
    providerSources.push({ name: cfg.provider, source: "environment", modelCount: envModels.length });
  }
  if (modelsJson?.providers) {
    for (const [name] of Object.entries(modelsJson.providers)) {
      if (name === cfg.provider) continue; // already listed from env
      const pModels = models.filter((m) => m.provider === name);
      providerSources.push({ name, source: "models.json", modelCount: pModels.length });
    }
  }

  return c.json({
    models,
    currentModel: cfg.readingModel,
    providers: providerSources,
  });
});
