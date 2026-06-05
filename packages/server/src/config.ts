/**
 * Global server configuration — reads from environment variables at startup.
 *
 * This is a singleton, resolved once. Changes require server restart.
 */

import type { ServerConfig } from "@pi-reader/shared";
import { DEFAULT_SERVER_CONFIG } from "@pi-reader/shared";

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
}

let _config: ServerConfigFull | null = null;

/**
 * Get the resolved server config (lazy-initialized from env vars).
 */
export function getServerConfig(): ServerConfigFull {
  if (_config) return _config;

  const readingModel = process.env.PI_MODEL ?? DEFAULT_SERVER_CONFIG.readingModel;

  _config = {
    readingModel,
    lookupModel: process.env.PI_LOOKUP_MODEL ?? readingModel,
    libraryPath: process.env.LIBRARY_PATH,
    dataPath: process.env.DATA_PATH,
    provider: process.env.PI_PROVIDER,
    apiKey: process.env.PI_API_KEY,
    baseUrl: process.env.PI_BASE_URL,
  };

  console.log(`[config] Reading model: ${_config.readingModel}`);
  console.log(`[config] Lookup model: ${_config.lookupModel}`);
  if (_config.provider) {
    console.log(`[config] Provider: ${_config.provider} (env)`);
  }

  return _config;
}
