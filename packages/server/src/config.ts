/**
 * Global server configuration — reads from environment variables at startup.
 *
 * This is a singleton, resolved once. Changes require server restart.
 */

import type { ServerConfig } from "@pi-reader/shared";
import { DEFAULT_SERVER_CONFIG } from "@pi-reader/shared";

let _config: ServerConfig | null = null;

/**
 * Get the resolved server config (lazy-initialized from env vars).
 */
export function getServerConfig(): ServerConfig {
  if (_config) return _config;

  const readingModel = process.env.PI_MODEL ?? DEFAULT_SERVER_CONFIG.readingModel;

  _config = {
    readingModel,
    lookupModel: process.env.PI_LOOKUP_MODEL ?? readingModel,
    libraryPath: process.env.LIBRARY_PATH,
    dataPath: process.env.DATA_PATH,
  };

  console.log(`[config] Reading model: ${_config.readingModel}`);
  console.log(`[config] Lookup model: ${_config.lookupModel}`);

  return _config;
}
