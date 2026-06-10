# @pi-tree/mcp

MCP **server** — exposes pi-tree to external AI tools (Claude Desktop, Cursor, etc.) via stdio.

> Not to be confused with the MCP **client** bridge (`packages/server/src/services/mcp-bridge.ts`) which lets pi-tree consume external MCP tools.

## Files

```
src/
  index.ts              (72L) — entry point, stdio transport, service init
  tools/
    library.ts         (124L) — list_sources, get_source_info, add_source
    sessions.ts        (204L) — list_sessions, create_session, get_session_tree
    chat.ts             (86L) — send_message, get_conversation
    reference.ts       (138L) — lookup_term, list_glossary, add_glossary_entry
```

## Direction

```
External AI (Claude, Cursor)  ──stdio──►  @pi-tree/mcp  ──imports──►  @pi-tree/server (DB, services)
```

## Setup

In Claude Desktop / Cursor MCP config:

```json
{
  "mcpServers": {
    "pi-tree": {
      "command": "node",
      "args": ["<repo>/packages/mcp/dist/index.js"]
    }
  }
}
```

## Boundary

- **May import**: `@pi-tree/server` (DB, services), `@pi-tree/shared`, `@modelcontextprotocol/sdk`
- **stdout** is reserved for MCP JSON-RPC — all logging goes to stderr
- Must `npm run build` before use (Claude/Cursor need `dist/index.js`)
