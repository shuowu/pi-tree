/**
 * MCP Bridge — connects to external MCP servers and exposes their tools.
 *
 * Reads server definitions from `$DATA_PATH/mcp.json` (same format as
 * Claude Desktop / Cursor). Spawns stdio or SSE connections, discovers
 * tools, and proxies tool calls from Pi SDK extensions.
 *
 * Usage:
 *   const bridge = getMcpBridge();
 *   await bridge.connectAll("/path/to/mcp.json");
 *   bridge.getTools();              // DiscoveredTool[]
 *   await bridge.callTool("brave-search", "web_search", { query: "..." });
 *   await bridge.disconnectAll();
 */

import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for a single MCP server */
export interface McpServerConfig {
  /** Command to spawn (stdio transport) */
  command?: string;
  /** Command args */
  args?: string[];
  /** Environment variables for the spawned process */
  env?: Record<string, string>;
  /** HTTP/SSE URL (alternative to command) */
  url?: string;
  /** Whether this server is disabled */
  disabled?: boolean;
}

/** Top-level mcp.json config */
export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/** A tool discovered from a connected MCP server */
export interface DiscoveredTool {
  /** Name of the MCP server this tool belongs to */
  serverName: string;
  /** Original tool name from the MCP server */
  name: string;
  /** Tool description */
  description?: string;
  /** JSON Schema for tool parameters */
  inputSchema: Record<string, unknown>;
}

/** Normalized content item returned by callTool */
export interface McpToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

/** Internal connection tracking */
interface ServerConnection {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  tools: DiscoveredTool[];
}

// ---------------------------------------------------------------------------
// Config loader (separated for testability)
// ---------------------------------------------------------------------------

/**
 * Load and validate an MCP config file. Returns null if missing or invalid.
 */
export function loadMcpConfig(configPath: string): McpConfig | null {
  if (!existsSync(configPath)) {
    console.log(`[mcp-bridge] No config at ${configPath} — skipping`);
    return null;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);

    if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
      console.log("[mcp-bridge] No mcpServers in config — skipping");
      return null;
    }

    if (Object.keys(config.mcpServers).length === 0) {
      console.log("[mcp-bridge] No servers configured");
      return null;
    }

    return config as McpConfig;
  } catch (err: any) {
    console.error(`[mcp-bridge] Failed to parse ${configPath}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// McpBridge
// ---------------------------------------------------------------------------

export class McpBridge {
  private connections = new Map<string, ServerConnection>();
  private allTools: DiscoveredTool[] = [];

  /**
   * Connect to all MCP servers defined in the config file.
   * Servers that fail to connect are logged and skipped.
   */
  async connectAll(configPath: string): Promise<void> {
    const config = loadMcpConfig(configPath);
    if (!config) return;

    const entries = Object.entries(config.mcpServers);
    console.log(`[mcp-bridge] Connecting to ${entries.length} server(s)...`);

    for (const [name, serverConfig] of entries) {
      if (serverConfig.disabled) {
        console.log(`[mcp-bridge] "${name}" is disabled — skipping`);
        continue;
      }
      try {
        await this.connectServer(name, serverConfig);
      } catch (err: any) {
        console.error(`[mcp-bridge] Failed to connect "${name}": ${err.message}`);
      }
    }

    console.log(
      `[mcp-bridge] Ready: ${this.allTools.length} tools from ${this.connections.size} server(s)`,
    );
  }

  /** Get all discovered tools across all connected servers */
  getTools(): DiscoveredTool[] {
    return this.allTools;
  }

  /** Check if any servers are connected */
  hasServers(): boolean {
    return this.connections.size > 0;
  }

  /** Get connected server names */
  getServerNames(): string[] {
    return [...this.connections.keys()];
  }

  /**
   * Call a tool on a specific MCP server.
   * Returns the raw MCP content array.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolContent[]> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server "${serverName}" is not connected`);
    }

    const result = await conn.client.callTool({ name: toolName, arguments: args });

    // Normalize MCP content to a clean shape
    return (result.content as any[])?.map((c) => ({
      type: c.type as string,
      ...(c.text !== undefined ? { text: c.text as string } : {}),
      ...(c.data !== undefined ? { data: c.data as string } : {}),
      ...(c.mimeType !== undefined ? { mimeType: c.mimeType as string } : {}),
    })) ?? [{ type: "text", text: JSON.stringify(result) }];
  }

  /** Disconnect all servers gracefully */
  async disconnectAll(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        await conn.client.close();
        console.log(`[mcp-bridge] Disconnected "${name}"`);
      } catch (err: any) {
        console.warn(`[mcp-bridge] Error disconnecting "${name}": ${err.message}`);
      }
    }
    this.connections.clear();
    this.allTools = [];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    let transport: StdioClientTransport | SSEClientTransport;

    if (config.command) {
      // Stdio transport — spawn a child process
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      });
    } else if (config.url) {
      // SSE transport — connect to HTTP endpoint
      transport = new SSEClientTransport(new URL(config.url));
    } else {
      console.warn(`[mcp-bridge] "${name}" has no command or url — skipping`);
      return;
    }

    const client = new Client(
      { name: "pi-tree", version: "0.1.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    // Discover tools
    const { tools: rawTools } = await client.listTools();
    const tools: DiscoveredTool[] = rawTools.map((t) => ({
      serverName: name,
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    }));

    this.connections.set(name, { client, transport, tools });
    this.allTools.push(...tools);

    console.log(`[mcp-bridge] Connected to "${name}" (${tools.length} tools)`);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _bridge: McpBridge | null = null;

export function getMcpBridge(): McpBridge {
  if (!_bridge) {
    _bridge = new McpBridge();
  }
  return _bridge;
}

/** Reset the singleton — used in tests */
export function resetMcpBridge(): void {
  _bridge = null;
}
