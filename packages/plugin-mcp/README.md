# MCP Plugin

Bridge to external MCP (Model Context Protocol) servers.

Connects pi-tree to any MCP-compatible tool server — web search, translation APIs, academic databases, and more — without adding code to the repo.

## Tools

Dynamically registered at startup from configured MCP servers. Each external tool is prefixed `mcp_{server}_{tool}`.

## Configuration

Add MCP servers to `$DATA_PATH/mcp.json`:

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-brave-search"],
      "env": { "BRAVE_API_KEY": "..." }
    }
  }
}
```

Format is compatible with Claude Desktop / Cursor MCP configuration.

## Skills

None.

## Profiles

None — MCP tools are included in all session profiles by default. The plugin no-ops silently when no MCP servers are configured.
