/**
 * Loads and caches `$DATA_PATH/models.json` — the user-defined provider/model
 * configuration file. Used by both the models API route (for listing) and
 * TreeManager (for session creation with the right provider config).
 *
 * Format matches Pi SDK's models.json (same as ~/.pi/agent/models.json):
 * ```json
 * {
 *   "providers": {
 *     "lmstudio": {
 *       "baseUrl": "http://localhost:1234/v1",
 *       "api": "openai-completions",
 *       "apiKey": "lmstudio",
 *       "models": [{ "id": "qwen/qwen3.6-27b" }]
 *     }
 *   }
 * }
 * ```
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelsJsonProvider {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  compat?: Record<string, boolean>;
  models?: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    contextWindow?: number;
    input?: string[];
    cost?: Record<string, number>;
  }>;
}

export interface ModelsJson {
  providers?: Record<string, ModelsJsonProvider>;
}

// ---------------------------------------------------------------------------
// Loader (cached)
// ---------------------------------------------------------------------------

let _cached: { data: ModelsJson | null; path: string } | null = null;

function getModelsJsonPath(): string {
  const dataPath =
    process.env.DATA_PATH ??
    join(os.homedir(), ".local", "share", "pi-tree");
  return join(dataPath, "models.json");
}

/**
 * Load and cache `$DATA_PATH/models.json`.
 * Returns null if the file doesn't exist or is invalid.
 */
export function loadModelsJson(): ModelsJson | null {
  const filePath = getModelsJsonPath();
  if (_cached && _cached.path === filePath) return _cached.data;

  if (!existsSync(filePath)) {
    _cached = { data: null, path: filePath };
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ModelsJson;
    console.log(`[models-json] Loaded from ${filePath}`);
    _cached = { data: parsed, path: filePath };
    return parsed;
  } catch (err) {
    console.warn(`[models-json] Failed to parse ${filePath}:`, err);
    _cached = { data: null, path: filePath };
    return null;
  }
}

/**
 * Resolve an API key value — supports `$ENV_VAR` syntax
 * (e.g., `"$ANTHROPIC_AUTH_TOKEN"` → reads from process.env).
 */
export function resolveApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? raw;
  }
  return raw;
}

/**
 * Find which provider from models.json owns a given model ID.
 * Returns the provider name and config, or null if not found.
 */
export function findProviderForModel(
  modelId: string,
): { name: string; config: ModelsJsonProvider } | null {
  const modelsJson = loadModelsJson();
  if (!modelsJson?.providers) return null;

  for (const [name, providerCfg] of Object.entries(modelsJson.providers)) {
    if (providerCfg.models?.some((m) => m.id === modelId)) {
      return { name, config: providerCfg };
    }
  }
  return null;
}

/**
 * Reset the cache — used in tests.
 */
export function resetModelsJsonCache(): void {
  _cached = null;
}
