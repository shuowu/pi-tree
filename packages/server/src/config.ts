import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import type { ServerConfig } from "@pi-tree/shared";
import { DEFAULT_SERVER_CONFIG } from "@pi-tree/shared";

/**
 * Extended server config with auth fields (not in shared types since
 * these are server-internal and should never reach the client).
 */
export interface ServerConfigFull extends ServerConfig {
  /** LLM provider name (e.g., "zhipu", "anthropic", "openai") */
  provider?: string;
  /** API key for the provider */
  apiKey?: string;
  /** Optional custom base URL for the provider */
  baseUrl?: string;
  /** Optional API type override (e.g., "openai-completions", "anthropic-messages") */
  api?: string;
}

let _config: ServerConfigFull | null = null;

function getConfigPath(): string {
  const dataPath =
    process.env.DATA_PATH ??
    join(os.homedir(), ".local", "share", "pi-tree");
  return join(dataPath, "global-config.json");
}

/**
 * Get the resolved server config (lazy-initialized from env vars or file).
 */
export function getServerConfig(): ServerConfigFull {
  if (_config) return _config;

  const configPath = getConfigPath();
  let fileConfig: Partial<ServerConfigFull> = {};

  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(data);
      console.log(`[config] Loaded global config overrides from ${configPath}`);
    } catch (err) {
      console.warn(`[config] Failed to parse global config file: ${err}`);
    }
  }

  _config = {
    readingModel:
      fileConfig.readingModel ||
      process.env.PI_MODEL ||
      "",
    lookupModel:
      fileConfig.lookupModel ||
      process.env.PI_LOOKUP_MODEL ||
      "",
    dataPath: process.env.DATA_PATH,
    provider:
      fileConfig.provider ||
      process.env.PI_PROVIDER ||
      "",
    apiKey:
      fileConfig.apiKey ||
      process.env.PI_API_KEY ||
      "",
    baseUrl:
      fileConfig.baseUrl ||
      process.env.PI_BASE_URL ||
      "",
    api:
      fileConfig.api ||
      process.env.PI_API_TYPE ||
      process.env.PI_API ||
      "",
  };

  console.log(`[config] Reading model: ${_config.readingModel}`);
  console.log(`[config] Lookup model: ${_config.lookupModel}`);
  if (_config.provider) {
    console.log(`[config] Provider: ${_config.provider}`);
  }
  if (_config.api) {
    console.log(`[config] API Type: ${_config.api}`);
  }

  return _config;
}

/**
 * Reset the cached config. Used in tests to ensure fresh config reads.
 */
export function resetServerConfig(): void {
  _config = null;
}

/**
 * Save server configuration dynamically and update the in-memory singleton.
 */
export function saveServerConfig(newConfig: Partial<ServerConfigFull>): ServerConfigFull {
  // 1. Read existing config from the file
  const configPath = getConfigPath();
  let existingFileConfig: Record<string, string> = {};
  if (existsSync(configPath)) {
    try {
      existingFileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // Ignore
    }
  }

  // 2. Determine API key to save in the file
  let finalFileApiKey: string | undefined = existingFileConfig.apiKey;
  if (newConfig.apiKey !== undefined) {
    if (newConfig.apiKey.includes("•")) {
      // Masked: keep whatever was already saved in the file
    } else if (newConfig.apiKey.trim() === "") {
      // Clear: remove override to fall back to env
      finalFileApiKey = undefined;
    } else {
      // New value: save it
      finalFileApiKey = newConfig.apiKey.trim();
    }
  }

  // 3. Merge: start from existing file config, overlay new non-empty fields.
  //    This preserves credential fields when only model preferences are sent.
  const toSave: Record<string, string> = { ...existingFileConfig };
  if (newConfig.provider !== undefined) {
    if (newConfig.provider.trim()) toSave.provider = newConfig.provider.trim();
    else delete toSave.provider;
  }
  if (newConfig.readingModel !== undefined) {
    if (newConfig.readingModel.trim()) toSave.readingModel = newConfig.readingModel.trim();
    else delete toSave.readingModel;
  }
  if (newConfig.lookupModel !== undefined) {
    if (newConfig.lookupModel.trim()) toSave.lookupModel = newConfig.lookupModel.trim();
    else delete toSave.lookupModel;
  }
  if (newConfig.baseUrl !== undefined) {
    if (newConfig.baseUrl.trim()) toSave.baseUrl = newConfig.baseUrl.trim();
    else delete toSave.baseUrl;
  }
  if (newConfig.api !== undefined) {
    if (newConfig.api.trim()) toSave.api = newConfig.api.trim();
    else delete toSave.api;
  }
  if (finalFileApiKey) toSave.apiKey = finalFileApiKey;
  else if (newConfig.apiKey !== undefined) delete toSave.apiKey;

  // 4. Save to disk
  try {
    const configDir = join(configPath, "..");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(toSave, null, 2), "utf-8");
    console.log(`[config] Saved global config overrides to ${configPath}`);
  } catch (err) {
    console.error(`[config] Failed to write global config file: ${err}`);
  }

  // 5. Update the dynamic in-memory reference using file overrides and env variables fallback
  _config = {
    readingModel: toSave.readingModel || process.env.PI_MODEL || "",
    lookupModel: toSave.lookupModel || process.env.PI_LOOKUP_MODEL || "",
    dataPath: process.env.DATA_PATH,
    provider: toSave.provider || process.env.PI_PROVIDER || "",
    apiKey: toSave.apiKey || process.env.PI_API_KEY || "",
    baseUrl: toSave.baseUrl || process.env.PI_BASE_URL || "",
    api: toSave.api || process.env.PI_API_TYPE || process.env.PI_API || "",
  };

  return _config;
}
