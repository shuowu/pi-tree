/**
 * Extension Services — dependency injection for agent extensions.
 *
 * Extensions should NOT import server internals directly. Instead, they
 * access server capabilities through this service locator, which the
 * server populates at startup before any extension is loaded.
 *
 * Usage in extensions:
 *   import { getExtensionServices } from "../../context.js";
 *   const { sources, sessions, users } = getExtensionServices();
 */

import type { McpBridge } from "../services/mcp-bridge.js";
import type { SourceService } from "../services/source-service.js";
import type { SessionService } from "../services/session-service.js";
import type { UserService } from "../services/user-service.js";
import type { MemoService } from "../services/memo-service.js";
import type { RegistryService, ExtensionConfig } from "@pi-tree/plugin-sdk";

// ---------------------------------------------------------------------------
// Service interface — what extensions can access
// ---------------------------------------------------------------------------

export interface ExtensionServices {
  // --- Typed service layer (preferred for extensions) ---

  /** Source queries: list, get */
  sources: SourceService;
  /** Session queries: listForSource, create, resolveUserId, getById */
  sessions: SessionService;
  /** User queries: get, ensureExists */
  users: UserService;
  /** Agent registry: profile introspection */
  registry: RegistryService;
  /** Extension configuration (API keys, feature flags) */
  config: ExtensionConfig;
  /** Get the scoped data directory for a plugin. Creates it if needed. */
  getPluginDataDir(pluginName: string): string;
  /** Get the data directory for a registered source. Creates it if needed. */
  getSourceDataDir(sourceId: string): string;
  /** MCP bridge for external tool access (optional — only set when mcp.json exists) */
  mcpBridge?: McpBridge;
  /** Absolute path to the mutable data directory */
  dataPath: string;
  /** Memo service — CRUD + search for user memos (optional) */
  memos?: MemoService;

  // --- Raw DB access (backward compat, power users) ---

  /** Get the Drizzle ORM database instance */
  db: () => any;
  /** Drizzle schema tables available to extensions */
  schema: {
    sources: any;
    userSessions: any;
    users: any;
  };
}

// ---------------------------------------------------------------------------
// Service locator
// ---------------------------------------------------------------------------

/**
 * Get the extension services. Must be called after server startup has
 * populated services via `setExtensionServices()`.
 */
export function getExtensionServices(): ExtensionServices {
  const services = (globalThis as any).__piTreeServices;
  if (!services) {
    throw new Error(
      "Extension services not initialized — server must call setExtensionServices() at startup",
    );
  }
  return services;
}

/**
 * Populate the extension services. Called once by the server at startup,
 * before any extension is loaded.
 */
export function setExtensionServices(services: ExtensionServices): void {
  (globalThis as any).__piTreeServices = services;
  console.log("[agents/context] Extension services initialized");
}
