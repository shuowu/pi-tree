# Self-Hosting Setup

This guide covers configuration, customization, and extending pi-tree for self-hosted deployments.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_PROVIDER` | — | LLM provider name (`anthropic`, `openai`, `google`, `zhipu`, `deepseek`, etc.) |
| `PI_API_KEY` | — | API key for your provider |
| `PI_BASE_URL` | — | Custom base URL (for proxies or self-hosted models) |
| `PI_MODEL` | — | Model ID for reading sessions (e.g., `claude-sonnet-4-20250514`) |
| `PI_LOOKUP_MODEL` | — | Model ID for dictionary lookups (can be a cheaper/faster model) |
| `DATA_PATH` | `~/.local/share/pi-tree` | Root for all state: sessions, database, library, user skills |
| `SKILLS_PATH` | `<DATA_PATH>/skills` | Custom skills directory |
| `EXTENSIONS_PATH` | `<DATA_PATH>/extensions` | Custom extensions directory |
| `PORT` | `3847` | Server port |
| `RSS_CRAWL_INTERVAL_MIN` | `30` | How often to crawl RSS feeds (in minutes) |

Env vars are the simplest way to configure a single provider. For multiple providers, use `models.json` below.

## Multi-Provider Models (`models.json`)

Pi-books uses Pi's native [`models.json`](https://pi.dev/docs/latest/models) for advanced model configuration. This lets you define multiple providers and models — e.g., Ollama for offline reading and DeepSeek for cloud — and switch between them at runtime.

Place the file at `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "gemma4:12b" },
        { "id": "qwen3.6:8b" }
      ]
    },
    "deepseek": {
      "apiKey": "$DEEPSEEK_API_KEY",
      "models": [
        { "id": "deepseek-v4-flash" }
      ]
    }
  }
}
```

**Resolution order**: env vars and `models.json` merge automatically. If you set `PI_PROVIDER` + `PI_API_KEY` in `.env` *and* have providers in `models.json`, all providers are available. The env var provider's API key takes precedence over `models.json` for that specific provider.

For Docker, mount the file into the container:

```yaml
volumes:
  - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
```

## Data Layout

```
<DATA_PATH>/                          # ~/.local/share/pi-tree by default
├── pi-tree.db                       # SQLite database (users, sessions, config)
├── mcp.json                          # MCP server config (optional, see below)
├── sessions/                         # Pi SDK session JSONL files
│   └── <bookId>/<userId>/            # Per-user per-book sessions
├── books/                            # Uploaded books (from UI)
│   └── <bookId>/
│       ├── original.epub             # Source file
│       ├── markdown/                 # Converted markdown
│       ├── analysis/                 # AI-generated outlines
│       └── cover.jpg                 # Cover image
├── news/                             # News feature data
│   ├── analyses/                     # AI-generated news analyses (.md)
│   └── summaries/                    # AI-generated news summaries (.md)
├── skills/                           # ← Your custom skills go here
│   └── my-skill/
│       └── SKILL.md
├── extensions/                       # ← Your custom extensions go here
│   └── my-extension/
│       └── index.ts
└── global-config.json                # Runtime config overrides (from Settings UI)
```

## Custom Skills

Skills are markdown instruction files that shape how the AI behaves during reading sessions. Pi-tree ships with 3 core skills — `interactive-reading`, `book-outline`, and `book-analysis` (in `packages/server/skills/`). You can add your own or override the core ones.

### Creating a skill

Create a directory with a `SKILL.md` file:

```
<DATA_PATH>/skills/socratic-reading/SKILL.md
```

The file uses YAML frontmatter + markdown body:

```markdown
---
name: socratic-reading
description: Guide reading through Socratic questioning
---

# Socratic Reading Skill

When discussing book content with the reader:

1. Never explain concepts directly — ask questions that lead to understanding
2. Start with the reader's interpretation: "What do you think the author means by...?"
3. Build on their answers with deeper questions
4. Only provide direct explanation if the reader explicitly asks
5. Reference specific passages from the book to ground the discussion
```

### Skill format

- **`name`** (required): Identifier for the skill
- **`description`** (required): One-line summary — shown to the AI as a skill catalogue entry
- **Body** (required): Detailed instructions the AI follows when the skill is activated

Skills follow the [Pi Agent Skills standard](https://agentskills.io). The same format works in the Pi terminal.

### Overriding core skills

To override a core skill, create a skill with the same name in your user skills directory:

```
<DATA_PATH>/skills/interactive-reading/SKILL.md
```

User skills load first. The Pi SDK uses first-wins dedup, so if a user skill has the same `name` as a core skill, the user version wins.

### How skills are discovered

On each new reading session, the server scans:

1. `<DATA_PATH>/skills/` (or `<SKILLS_PATH>/`) — **user skills (loaded first, wins on name collision)**
2. `packages/server/skills/` — core skills (shipped with the app)

No restart is needed — new skills are picked up when a reading session starts.

## Custom Extensions

Extensions are TypeScript modules that register tools and commands with the Pi agent. They're more powerful than skills — they can execute code, call APIs, and provide interactive tools.

### Creating an extension

```
<DATA_PATH>/extensions/my-tool/index.ts
```

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function myExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Does something useful",
    parameters: Type.Object({
      input: Type.String({ description: "Input text" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Your logic here
      return {
        content: [{ type: "text", text: `Result: ${params.input}` }],
        details: { input: params.input },
      };
    },
  });
}
```

Extensions are loaded at runtime via [jiti](https://github.com/unjs/jiti) — no build step required. They have access to the full Pi extension API (tools, commands, events).

> **Note**: Extensions run with the server's permissions. Only load extensions you trust.

## MCP Bridge (External Tools)

Pi-tree can connect to external [MCP servers](https://modelcontextprotocol.io) and expose their tools to the AI agent. This lets you add web search, academic databases, translation APIs, or any MCP-compatible tool without writing code.

### Configuration

Create `<DATA_PATH>/mcp.json` (same format as Claude Desktop / Cursor):

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-brave-search"],
      "env": { "BRAVE_API_KEY": "your-key-here" }
    },
    "fetch": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-fetch"]
    }
  }
}
```

Each server entry can have:

- **`command`** + **`args`**: Spawn a stdio-based MCP server (most common)
- **`url`**: Connect to an HTTP/SSE-based MCP server (alternative to command)
- **`env`**: Environment variables passed to the spawned process
- **`disabled`**: Set to `true` to skip this server without removing the config

### How it works

On server startup, the MCP bridge:

1. Reads `<DATA_PATH>/mcp.json`
2. Connects to each configured server via stdio or SSE
3. Discovers available tools via `tools/list`
4. Registers each tool with the Pi SDK, prefixed as `mcp_<server>_<tool>` (e.g., `mcp_brave-search_web_search`)

The AI agent can then use these tools during any session. If an MCP server disconnects unexpectedly, the bridge attempts to reconnect automatically with exponential backoff.

If no `mcp.json` exists or is empty, the MCP bridge silently does nothing — no configuration is needed if you don't want external tools.

### Docker

Mount the config file and ensure the MCP server commands are available:

```yaml
volumes:
  - ./mcp.json:/data/mcp.json:ro
```

For MCP servers that use `npx`, Node.js must be available in the container (it is by default).

## News Feeds

Pi-tree includes an RSS news feed feature. Feeds are crawled on a schedule, and the AI can analyze, summarize, and discuss recent news with you.

### Default feeds

On first startup, pi-tree seeds a small set of default feeds (Hacker News, TechCrunch, Ars Technica, The Verge, MIT Tech Review, Nature, Quanta, Reuters, BBC) from `packages/server/config/default-feeds.yml`. These are only seeded if no feeds exist yet — they won't overwrite feeds you've added.

### Managing feeds

Feeds can be managed through the web UI (News section) or the API:

```bash
# List feeds
curl http://localhost:3847/api/news/feeds

# Add a feed
curl -X POST http://localhost:3847/api/news/feeds \
  -H "Content-Type: application/json" \
  -d '{"id": "ars-technica", "name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/index", "tags": ["tech"]}'

# Remove a feed
curl -X DELETE http://localhost:3847/api/news/feeds/ars-technica

# Trigger a manual crawl
curl -X POST http://localhost:3847/api/news/crawl
```

### Crawl schedule

Feeds are crawled automatically every 30 minutes by default. Set `RSS_CRAWL_INTERVAL_MIN` to change the interval. On startup, feeds are crawled immediately if they're stale (no crawl in the last interval).

### Data storage

News data lives under `<DATA_PATH>/news/`:

- `analyses/` — AI-generated news analyses (Markdown files)
- `summaries/` — AI-generated news summaries (Markdown files)

Feed metadata and cached articles are stored in the SQLite database.

## Docker Compose

### Basic setup

```yaml
services:
  pi-tree:
    build: .
    ports:
      - "3847:3847"
    environment:
      - PI_PROVIDER=anthropic
      - PI_API_KEY=${PI_API_KEY}
      - PI_MODEL=claude-sonnet-4-20250514
    volumes:
      - ./library:/library:ro          # your books (read-only)
      - pi-tree-data:/data            # mutable state

volumes:
  pi-tree-data:
```

### With custom skills

Mount a host directory into the data volume's skills path:

```yaml
services:
  pi-tree:
    build: .
    ports:
      - "3847:3847"
    environment:
      - PI_PROVIDER=anthropic
      - PI_API_KEY=${PI_API_KEY}
      - SKILLS_PATH=/data/skills
      - EXTENSIONS_PATH=/data/extensions
    volumes:
      - ./library:/library:ro
      - pi-tree-data:/data
      - ./my-skills:/data/skills:ro        # your custom skills
      - ./my-extensions:/data/extensions:ro # your custom extensions

volumes:
  pi-tree-data:
```

### Using a local LLM (Ollama, etc.)

```yaml
environment:
  - PI_PROVIDER=openai           # Ollama exposes an OpenAI-compatible API
  - PI_API_KEY=not-needed
  - PI_BASE_URL=http://host.docker.internal:11434/v1
  - PI_MODEL=llama3.1:70b
```

## Runtime Configuration

Settings can also be changed at runtime through the web UI (Settings page), which writes to `<DATA_PATH>/global-config.json`. This overrides environment variables for:

- Reading model
- Lookup model
- Provider
- API key
- Base URL

Environment variables are used as initial defaults. The config file takes precedence once saved.
