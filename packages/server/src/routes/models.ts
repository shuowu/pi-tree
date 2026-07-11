/**
 * Model listing route — returns all registered models from env config
 * and $DATA_PATH/models.json.
 *
 * Mounted at `/api/models`.
 */

import { join } from "node:path";
import { Hono } from "hono";
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { getServerConfig } from "../config.js";
import { configureModelRegistry } from "@pi-tree/core";
import {
  findProviderForModel,
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

  // Filter to allowed providers only — no escape hatch for currentModel
  // to avoid leaking built-in SDK providers (e.g. openrouter) that share
  // model IDs with user-defined providers from models.json.
  const filtered = allModels.filter(
    (m) => allowedProviders.has(m.provider),
  );

  // Deduplicate by model ID — prefer models.json providers, then the
  // env-configured provider, over built-in SDK entries.
  const seen = new Map<string, (typeof filtered)[number]>();
  for (const m of filtered) {
    const existing = seen.get(m.id);
    if (
      !existing ||
      m.provider === cfg.provider ||
      modelsJsonProviders.has(m.provider)
    ) {
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

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 30_000;

/**
 * POST /api/models/test — send a minimal one-shot prompt to the given model
 * and report success/failure + latency. Mirrors TreeManager's provider
 * resolution: models owned by a models.json provider (other than the
 * env-configured one) use that provider's baseUrl/apiKey/api.
 */
modelRoutes.post("/test", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return c.json({ ok: false, error: "model is required" }, 400);
  }

  const cfg = getServerConfig();

  let providerOverride: Record<string, unknown> = {};
  const modelsJsonProvider = findProviderForModel(model);
  if (modelsJsonProvider && modelsJsonProvider.name !== cfg.provider) {
    providerOverride = {
      provider: modelsJsonProvider.name,
      apiKey: resolveApiKey(modelsJsonProvider.config.apiKey),
      baseUrl: modelsJsonProvider.config.baseUrl,
      api: modelsJsonProvider.config.api,
      ...(modelsJsonProvider.config.compat ? { compat: modelsJsonProvider.config.compat } : {}),
    };
  }

  const started = Date.now();
  try {
    const response = await pingModel({ ...cfg, ...providerOverride, readingModel: model });
    return c.json({
      ok: true,
      model,
      latencyMs: Date.now() - started,
      response: response.trim().slice(0, 200),
    });
  } catch (err) {
    console.warn(`[models] connection test failed for "${model}":`, err);
    return c.json({
      ok: false,
      model,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Single ephemeral in-memory completion — same pattern as the intent classifier. */
async function pingModel(config: Parameters<typeof configureModelRegistry>[0]): Promise<string> {
  const repoRoot = join(import.meta.dirname, "../../../..");
  const { authStorage, modelRegistry, selectedModel } = configureModelRegistry(config);

  const { session } = await createAgentSession({
    cwd: repoRoot,
    tools: [],
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(),
    // The session swallows request errors and retries with backoff — for a
    // connection test the first error IS the result. In-memory so the
    // retry override never touches the user's settings file.
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
    authStorage,
    modelRegistry,
    ...(selectedModel ? { model: selectedModel } : {}),
  });

  const agentSession = session as AgentSession;
  let full = "";
  const unsubscribe = agentSession.subscribe(async (event: AgentSessionEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      full += event.assistantMessageEvent.delta ?? "";
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.prompt('Connection test — reply with the single word "OK".'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No response within ${TEST_TIMEOUT_MS / 1000}s`)),
          TEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
    session.dispose();
  }

  const error = agentSession.agent.state.errorMessage;
  if (error) throw new Error(error);
  return full;
}
