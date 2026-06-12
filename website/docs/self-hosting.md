---
title: Self-Hosting Guide
description: Complete guide to configuring, customizing, and extending a self-hosted pi-tree deployment — environment variables, data layout, custom skills, extensions, session profiles, MCP bridge, news feeds, and runtime configuration.
---

# Self-Hosting Guide

This guide covers everything you need to configure, customize, and extend your self-hosted pi-tree deployment. Whether you're running pi-tree directly on your machine or via [Docker](/docs/docker), the configuration concepts are the same.

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
| `JINA_API_KEY` | — | Optional [Jina Reader](https://jina.ai/reader/) API key for article extraction. Without it, the anonymous tier (20 RPM) is used. With a key, you get 100 RPM and token tracking. |

:::tip
Env vars are the simplest way to configure a single provider. For multiple providers, use `models.json` — see [Multi-Provider Models](/docs/models).
:::

## Multi-Provider Models (`models.json`)

Pi-tree uses Pi's native [`models.json`](https://pi.dev/docs/latest/models) for advanced model configuration. This lets you define multiple providers and models — e.g., Ollama for offline reading and DeepSeek for cloud — and switch between them at runtime.

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

:::info Resolution Order
Env vars and `models.json` merge automatically. If you set `PI_PROVIDER` + `PI_API_KEY` in `.env` *and* have providers in `models.json`, all providers are available. The env var provider's API key takes precedence over `models.json` for that specific provider.
:::

For Docker, mount the file into the container:

```yaml
volumes:
  - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
```

See the [Models guide](/docs/models) for more details on model configuration.

## Data Layout

All mutable state lives under `DATA_PATH` (default: `~/.local/share/pi-tree/`):

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

Skills are markdown instruction files that shape how the AI behaves during reading sessions. Pi-tree ships with core skills — `interactive-reading`, `book-outline`, `book-analysis`, `news-reading`, and `session-router` — built into the server package. You can add your own or override the core ones.

### Creating a Skill

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

### Skill Format

- **`name`** (required): Identifier for the skill
- **`description`** (required): One-line summary — shown to the AI as a skill catalogue entry
- **Body** (required): Detailed instructions the AI follows when the skill is activated

Skills follow the [Pi Agent Skills standard](https://agentskills.io). The same format works in the Pi terminal.

### Overriding Core Skills

To override a core skill, create a skill with the same name in your user skills directory:

```
<DATA_PATH>/skills/interactive-reading/SKILL.md
```

User skills load first. The Pi SDK uses first-wins dedup, so if a user skill has the same `name` as a core skill, the user version wins.

### How Skills Are Discovered

On each new reading session, the server scans:

1. `<DATA_PATH>/skills/` (or `<SKILLS_PATH>/`) — **user skills (loaded first, wins on name collision)**
2. `packages/server/src/agents/skills/` — core skills (shipped with the app)

:::tip
No restart is needed — new skills are picked up when a reading session starts.
:::

## Custom Extensions

Extensions are TypeScript modules that register tools and commands with the Pi agent. They're more powerful than skills — they can execute code, call APIs, and provide interactive tools.

### Creating an Extension

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

:::warning
Extensions run with the server's permissions. Only load extensions you trust.
:::

## Custom Session Profiles

Session profiles define the "recipe" for an AI session — which skills, extensions, and model to use. Pi-tree ships with built-in profiles for books and news, but you can define your own to add custom session modes for existing source types.

### Creating a Profile

Create a YAML file in `<DATA_PATH>/profiles/` (one file per profile):

```yaml
# ~/.local/share/pi-tree/profiles/socratic-discussion.yml
name: socratic-discussion
label: Socratic Discussion
description: Explore ideas through dialectical questioning
source_type: book

skills:
  - socratic-reading
```

### Profile Format

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (used as profile key, e.g. `socratic-discussion`) |
| `label` | Yes | Human-readable name shown in the UI |
| `description` | No | One-line summary of what this profile does |
| `source_type` | No | Source type this profile applies to (e.g. `book`, `news`). Shown only for matching sources. |
| `skills` | Yes | List of skill names to load (must exist in skills dirs) |
| `extensions` | No | List of extension names to load (default: `[]`) |
| `exclude_tools` | No | Pi SDK tools to block (default: `["bash", "edit"]`) |
| `model` | No | Model override (falls back to server default) |

### How Profiles Are Used

User profiles appear as additional session modes in the SessionPicker for matching source types. They are discovered at startup and merged with built-in profiles.

:::info
User profiles override built-in profiles with the same name.
:::

## MCP Bridge (External Tools) {#mcp-bridge}

Pi-tree can connect to external [MCP servers](https://modelcontextprotocol.io) and expose their tools to the AI agent. This lets you add web search, academic databases, translation APIs, or any MCP-compatible tool — without writing code.

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

:::tip
A ready-made template with popular servers lives at `packages/server/config/mcp.example.json`. Copy it to your data path and enable what you need:

```bash
cp packages/server/config/mcp.example.json ~/.local/share/pi-tree/mcp.json
```
:::

Each server entry can have:

- **`command`** + **`args`**: Spawn a stdio-based MCP server (most common)
- **`url`**: Connect to an HTTP/SSE-based MCP server (alternative to command)
- **`env`**: Environment variables passed to the spawned process
- **`disabled`**: Set to `true` to skip this server without removing the config

### How It Works

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

See the [Docker guide](/docs/docker) for more container configuration examples.

## News Feeds

Pi-tree includes an RSS news feed feature. Feeds are crawled on a schedule, and the AI can analyze, summarize, and discuss recent news with you.

### Default Feeds

On first startup, pi-tree seeds a small set of default feeds (Hacker News, TechCrunch, Ars Technica, The Verge, MIT Tech Review, Nature, Quanta, Reuters, BBC) from `packages/server/config/default-feeds.yml`. These are only seeded if no feeds exist yet — they won't overwrite feeds you've added.

### Managing Feeds

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

### Crawl Schedule

Feeds are crawled automatically every 30 minutes by default. Set `RSS_CRAWL_INTERVAL_MIN` to change the interval. On startup, feeds are crawled immediately if they're stale (no crawl in the last interval).

### Data Storage

News data lives under `<DATA_PATH>/news/`:

- `analyses/` — AI-generated news analyses (Markdown files)
- `summaries/` — AI-generated news summaries (Markdown files)

Feed metadata and cached articles are stored in the SQLite database.

For Docker-specific setup (Compose files, volumes, local LLM), see the [Docker guide](/docs/docker).

## Runtime Configuration

Settings can also be changed at runtime through the web UI (**Settings** page), which writes to `<DATA_PATH>/global-config.json`. This overrides environment variables for:

- Reading model
- Lookup model
- Provider
- API key
- Base URL

:::info
Environment variables are used as initial defaults. The `global-config.json` file takes precedence once saved through the Settings UI.
:::
