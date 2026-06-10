/**
 * Extension Services — dependency injection for agent extensions.
 *
 * Extensions should NOT import server internals directly. Instead, they
 * access server capabilities through this service locator, which the
 * server populates at startup before any extension is loaded.
 *
 * Usage in extensions:
 *   import { getExtensionServices } from "../../context.js";
 *   const { db, schema } = getExtensionServices();
 */

import type { McpBridge } from "../services/mcp-bridge.js";

// ---------------------------------------------------------------------------
// Service interface — what extensions can access
// ---------------------------------------------------------------------------

export interface ExtensionServices {
  /** Get the Drizzle ORM database instance */
  db: () => any;
  /** Drizzle schema tables available to extensions */
  schema: {
    sources: any;
    userSessions: any;
    users: any;
  };
  /** RSS feed service instance for news extensions */
  rssService: any;
  /** MCP bridge for external tool access (optional — only set when mcp.json exists) */
  mcpBridge?: McpBridge;
}

// ---------------------------------------------------------------------------
// Service locator
// ---------------------------------------------------------------------------

/**
 * Get the extension services. Must be called after server startup has
 * populated services via `setExtensionServices()`.
 */
export function getExtensionServices(): ExtensionServices {
  const services = (globalThis as any).__piTreeExtensionServices;
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
  (globalThis as any).__piTreeExtensionServices = services;
  console.log("[agents/context] Extension services initialized");
}
