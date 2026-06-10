# @pi-tree/mcp — MCP Server

> **This package exposes pi-tree as an MCP _server_.**
> It is the opposite of the MCP _client_ bridge in `packages/server/src/services/mcp-bridge.ts`.

## What this does

External AI tools (Claude Desktop, Cursor, VS Code Copilot, etc.) can connect to this server and interact with your pi-tree library — browse sources, manage sessions, chat, and look up glossary terms — all via the standard [Model Context Protocol](https://modelcontextprotocol.io).

```
┌──────────────────┐     stdio (JSON-RPC)     ┌─────────────────┐
│  Claude Desktop  │ ◄──────────────────────► │  @pi-tree/mcp   │
│  Cursor / VS Code│                          │  (this package)  │
└──────────────────┘                          └────────┬────────┘
                                                       │ imports
                                                       ▼
                                              ┌─────────────────┐
                                              │ @pi-tree/server  │
                                              │  (DB, services)  │
                                              └─────────────────┘
```

## vs. the MCP Client Bridge

| | This package (`packages/mcp`) | Client bridge (`packages/server`) |
|---|---|---|
| **Direction** | pi-tree **serves** tools to external AI | pi-tree **consumes** tools from external MCP servers |
| **Transport** | stdio (spawned by Claude/Cursor) | stdio or SSE (spawns child processes) |
| **Config** | External tool's `mcp.json` | `$DATA_PATH/mcp.json` |
| **Purpose** | Let other AIs use your library | Give pi-tree's AI web search, etc. |

## Tools exposed

| Tool group | Tools | Source |
|------------|-------|--------|
| **Library** | `list_sources`, `get_source_info`, `add_source` | `src/tools/library.ts` |
| **Sessions** | `list_sessions`, `create_session`, `get_session_tree` | `src/tools/sessions.ts` |
| **Chat** | `send_message`, `get_conversation` | `src/tools/chat.ts` |
| **Reference** | `lookup_term`, `list_glossary`, `add_glossary_entry` | `src/tools/reference.ts` |

## Usage

### In Claude Desktop / Cursor

Add to your MCP config (`~/.config/claude/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pi-tree": {
      "command": "node",
      "args": ["<path-to-repo>/packages/mcp/dist/index.js"]
    }
  }
}
```

### Dev mode

```bash
npx tsx --conditions=source packages/mcp/src/index.ts
```

### Binary

The package exposes a `pi-tree-mcp` bin entry, so after `npm link` or global install:

```bash
pi-tree-mcp
```

## Notes

- **stdout is reserved** for MCP JSON-RPC protocol. All logging goes to stderr.
- Shares the same SQLite database and `DATA_PATH` as the main server.
- Must be built (`npm run build`) before use with Claude Desktop (which needs `dist/index.js`).
