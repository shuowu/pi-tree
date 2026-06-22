/**
 * Lightweight logger with level filtering and consistent prefixes.
 *
 * Usage:
 *   import { createLogger } from "../lib/logger.js";
 *   const log = createLogger("agent-registry");
 *   log.info("Loaded 5 plugins");      // [agent-registry] Loaded 5 plugins
 *   log.debug("Scanning dir", dir);     // silenced unless LOG_LEVEL=debug
 *   log.warn("Missing field");          // [agent-registry] ⚠ Missing field
 *   log.error("Failed to parse", err);  // [agent-registry] ✗ Failed to parse ...
 *
 * Control via LOG_LEVEL env var: "debug" | "info" | "warn" | "error" (default: "info")
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function getThreshold(): number {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVELS[env] ?? LEVELS.info;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Create a namespaced logger. The prefix is prepended to every message.
 *
 * ```ts
 * const log = createLogger("bootstrap");
 * log.info("Server started on port", 3947);
 * // → [bootstrap] Server started on port 3947
 * ```
 */
export function createLogger(prefix: string): Logger {
  const tag = `[${prefix}]`;

  return {
    debug: (...args) => {
      if (getThreshold() <= LEVELS.debug) console.debug(tag, ...args);
    },
    info: (...args) => {
      if (getThreshold() <= LEVELS.info) console.log(tag, ...args);
    },
    warn: (...args) => {
      if (getThreshold() <= LEVELS.warn) console.warn(tag, `⚠`, ...args);
    },
    error: (...args) => {
      if (getThreshold() <= LEVELS.error) console.error(tag, `✗`, ...args);
    },
  };
}
