#!/usr/bin/env node
/**
 * Pi-Tree MCP Server — entry point.
 *
 * Starts a Model Context Protocol server over stdio transport.
 * AI tools (Claude Desktop, Cursor, VS Code, etc.) spawn this as a child process
 * and communicate via stdin/stdout using JSON-RPC.
 *
 * Usage:
 *   node packages/mcp/dist/index.js
 *   # or in dev:
 *   npx tsx --conditions=source packages/mcp/src/index.ts
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "@pi-tree/server/db";
import { LibraryService } from "@pi-tree/server/services/library";
import { DictionaryService } from "@pi-tree/server/services/dictionary.service";
import { registerLibraryTools } from "./tools/library.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerChatTools } from "./tools/chat.js";
import { registerReferenceTools } from "./tools/reference.js";

// ---------------------------------------------------------------------------
// Load environment
// ---------------------------------------------------------------------------

const root = resolve(import.meta.dirname, "../../..");
loadEnv({ path: resolve(root, ".env") });

// Dev defaults — separate port/DB so dev never collides with Docker
if (process.env.NODE_ENV !== "production") {
  process.env.PORT ??= "3947";
  process.env.DATA_PATH ??= "~/.local/share/pi-tree-dev";
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

// Initialize database (creates tables if needed)
getDb();

// Create services
const libraryService = new LibraryService();
const dictionaryService = DictionaryService.getInstance();

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "pi-tree",
  version: "0.1.0",
});

// Register all tools
registerLibraryTools(server, { libraryService });
registerSessionTools(server, { libraryService });
registerChatTools(server, { libraryService });
registerReferenceTools(server, { dictionaryService });

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr (stdout is reserved for MCP protocol)
console.error("🔌 pi-tree MCP server running on stdio");
