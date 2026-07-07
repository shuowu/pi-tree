---
title: Self-Hosting Guide
description: Complete guide to configuring, customizing, and extending a self-hosted pi-tree deployment — environment variables, data layout, Docker Compose, custom skills, extensions, session profiles, MCP bridge, and more.
---

# Self-Hosting Guide

This guide covers everything you need to configure, customize, and extend your pi-tree deployment. Whether you're running from source or via Docker, the configuration concepts are the same.

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
│   └── <sourceId>/<userId>/          # Per-user per-source sessions
├── sources/                          # All source content (books, news, etc.)
│   ├── <sourceId>/
│   │   ├── original.epub             # Uploaded source file
│   │   ├── markdown/                 # Converted markdown
│   │   ├── analysis/                 # AI-generated outlines
│   │   └── cover.jpg                 # Cover image
│   └── news/                         # News plugin data
│       ├── analyses/                 # AI-generated news analyses (.md)
│       └── summaries/                # AI-generated news summaries (.md)
├── plugins/                          # Plugin-specific data
│   └── news/
│       └── news.db                   # News plugin's own database
├── skills/                           # ← Your custom skills go here
│   └── my-skill/
│       └── SKILL.md
├── extensions/                       # ← Your custom extensions go here
│   └── my-extension/
│       └── index.ts
└── global-config.json                # Runtime config overrides (from Settings UI)
```

## Docker Compose {#docker}

Docker Compose is the recommended way to manage pi-tree in production. The [Getting Started](/docs/getting-started) page covers the basics of `docker run` — this section covers advanced Compose setups.

### Basic Setup

```yaml
services:
  pi-tree:
    image: ghcr.io/shuowu/pi-tree:latest
    restart: unless-stopped
    ports:
      - "3847:3847"
    environment:
      - PI_PROVIDER=anthropic
      - PI_API_KEY=${PI_API_KEY}
      - PI_MODEL=claude-sonnet-4-20250514
    volumes:
      - ~/.local/share/pi-tree:/data    # all state: DB, sessions, library
```

### With Custom Skills, Extensions, and MCP Tools

```yaml
volumes:
  - pi-tree-data:/data
  - ./my-skills:/data/skills:ro          # your custom skills
  - ./my-extensions:/data/extensions:ro  # your custom extensions
  - ./mcp.json:/data/mcp.json:ro        # MCP server config
```

### Using a Local LLM {#docker-local-llm}

If you're running [Ollama](https://ollama.com/download), [LM Studio](https://lmstudio.ai/), or another local model server on the host machine, there are a few networking and compatibility details to get right.

#### 1. Enable Docker-to-host networking

Docker containers can't reach `localhost` on the host. You need `host.docker.internal` to resolve to the host machine:

```yaml
services:
  pi-tree:
    # ... your other config ...
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

:::info
`extra_hosts` is required on **Linux**. On Docker Desktop (macOS/Windows), `host.docker.internal` works out of the box — but adding it explicitly doesn't hurt.
:::

#### 2. Bind your model server to all interfaces

Local model servers typically bind to `127.0.0.1` (localhost only) by default. Docker containers connect via the host's bridge IP, so the server must listen on `0.0.0.0`:

**Ollama** — listens on `0.0.0.0` by default. No changes needed.

**LM Studio** — binds to `127.0.0.1` by default. Change it:

```bash
# Via CLI (preferred)
lms server stop
lms server start --bind 0.0.0.0

# Or edit ~/.lmstudio/.internal/http-server-config.json
# Change "networkInterface": "127.0.0.1" → "networkInterface": "0.0.0.0"
```

#### 3. Configure the provider

**Simple setup** (single local provider via env vars):

```yaml
environment:
  - PI_PROVIDER=ollama
  - PI_API_KEY=not-needed
  - PI_BASE_URL=http://host.docker.internal:11434/v1
  - PI_MODEL=gemma4:12b
```

**Multi-provider setup** (local + cloud via `models.json`):

```json
{
  "providers": {
    "lmstudio": {
      "baseUrl": "http://host.docker.internal:1234/v1",
      "api": "openai-completions",
      "apiKey": "not-needed",
      "compat": { "supportsDeveloperRole": false },
      "models": [
        { "id": "qwen/qwen3.6-27b" }
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

Mount the file into the container:

```yaml
volumes:
  - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
```

:::tip Compatibility flags
Local model servers don't always support all OpenAI API features. The `compat` field tells pi-tree how to adapt:

| Flag | Default | When to set `false` |
|------|---------|-------------------|
| `supportsDeveloperRole` | `true` | LM Studio, Ollama, and most local servers only support `system` and `user` roles — not the `developer` role. Set this to `false` to avoid silent failures. |

If your local model returns empty responses or hangs, missing `compat` flags are usually the cause.
:::

#### Complete Docker Compose example

A full working setup with a local LM Studio provider and a cloud fallback:

```yaml
services:
  pi-tree:
    image: ghcr.io/shuowu/pi-tree:latest
    restart: unless-stopped
    ports:
      - "3847:3847"
    env_file: .env
    volumes:
      - ${PI_TREE_DATA:-./data}:/data
      - ~/.pi/agent/models.json:/root/.pi/agent/models.json:ro
    environment:
      - DATA_PATH=/data
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### Volumes

| Mount Point | Purpose | Access |
|-------------|---------|--------|
| `/data` | All state — database, sessions, library, processed content | Read-write |

The `/data` volume contains everything pi-tree needs: the SQLite database, session files, uploaded books, processed content, and user configuration.

### Build from Source

If you prefer to build the image locally instead of using the pre-built one:

```bash
docker compose up --build
```

This builds the image from the `Dockerfile` in the repository root and starts the container.

## Custom Skills

Skills are markdown instruction files that shape how the AI behaves during reading sessions. Core skills are bundled with their respective plugins: `interactive-reading`, `book-outline`, `book-analysis` (book plugin), `news-reading` (news plugin), `paper-reading` (paper plugin), `youtube-watching` (YouTube plugin), and `session-router` (server). You can add your own or override the core ones.

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
2. Plugin-bundled skills (`packages/plugin-*/skills/`) — shipped with each plugin
3. Server-bundled skills (`packages/server/src/agents/skills/`) — core routing

:::tip
No restart is needed — new skills are picked up when a reading session starts.
:::

## Custom Tools (Pi Extensions)

Pi-tree's built-in capabilities come from plugins. For lightweight custom tools that don't need the full plugin system, you can use Pi SDK's extension mechanism directly.

Extensions are TypeScript modules that register tools and commands with the Pi agent. They're more powerful than skills — they can execute code, call APIs, and provide interactive tools.

### Creating an Extension

```
<DATA_PATH>/extensions/my-tool/index.ts
```

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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

## Custom Source Types {#custom-source-types}

Pi-tree ships with built-in support for books, news, and papers — but you can define your own source types for any content. Custom source types combine three pieces you've already seen: **content**, **skills**, and **profiles**.

### The Complete Flow

Here's how to add a custom source type, end to end:

#### 1. Prepare Your Content

Place your content as a markdown file at:

```
<DATA_PATH>/sources/<source-id>/markdown/content.md
```

You can convert from any format — PDF, HTML, Notion export, Obsidian vault, etc. — using tools like Pandoc, Calibre, or any other converter. Pi-tree reads markdown.

Alternatively, you can create the source via the API with a `contentPath` and the server copies the file for you:

```bash
curl -X POST http://localhost:3847/api/library/sources/create \
  -H "Content-Type: application/json" \
  -d '{"id": "my-tutorial", "title": "React Tutorial", "type": "tutorial", "contentPath": "/path/to/tutorial.md"}'
```

#### 2. Create a Skill (Optional)

If you want custom AI behavior for your source type, create a skill:

```
<DATA_PATH>/skills/tutorial-reading/SKILL.md
```

```markdown
---
name: tutorial-reading
description: Guided tutorial walkthrough with exercises and checkpoints
---

# Tutorial Reading

## Workflow
1. Read the tutorial content section by section
2. Explain concepts with practical examples
3. Suggest exercises at natural checkpoints
4. Track progress through the tutorial
```

#### 3. Create a Profile

Wire your skill to a source type with a profile:

```yaml
# <DATA_PATH>/profiles/tutorial-reading.yml
name: tutorial.reading
label: Tutorial Reading
source_type: tutorial
skills: [tutorial-reading]
extensions: [mcp]
exclude_tools: [bash, edit]
```

The `source_type: tutorial` field makes this profile appear as a session mode only for sources of type `tutorial`.

#### 4. Register the Source

Create the source via the API:

```bash
curl -X POST http://localhost:3847/api/library/sources/create \
  -H "Content-Type: application/json" \
  -d '{
    "id": "react-tutorial",
    "title": "React Tutorial",
    "type": "tutorial",
    "author": "optional"
  }'
```

If you already placed the content at `<DATA_PATH>/sources/react-tutorial/markdown/content.md` (step 1), you're set. The app will look up the `tutorial.reading` profile, load your custom skill, and start a session with your custom flow.

### Example: Codebase Explorer

A complete custom source type for exploring codebases:

```
<DATA_PATH>/
  skills/
    codebase-reading/
      SKILL.md              ← "Walk through this codebase…"
  extensions/
    codebase/
      index.ts              ← clone_repo, list_files tools
  profiles/
    codebase-reading.yml    ← wires skill + extension
```

```yaml
# profiles/codebase-reading.yml
name: codebase.reading
label: Codebase Explorer
source_type: codebase
skills: [codebase-reading]
extensions: [codebase, mcp]
```

See the [Plugin Guide](/docs/examples) for full examples and API reference.

### Profile Resolution Order

When starting a session for source type `T` with mode `M`:

1. `T.M` — exact match (e.g., `tutorial.reading`)
2. `T` — source type fallback (e.g., `tutorial`)
3. `_default` — universal fallback

This means **custom source types always work** — even without a custom profile, they fall back to `_default`.

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

For Docker, mount the config file:

```yaml
volumes:
  - ./mcp.json:/data/mcp.json:ro
```

## News Feeds

Pi-tree includes an RSS news feed feature. Feeds are crawled on a schedule, and the AI can analyze, summarize, and discuss recent news with you.

### Default Feeds

On first startup, pi-tree seeds a small set of default feeds (Hacker News, TechCrunch, Ars Technica, The Verge, MIT Tech Review, Nature, Quanta, Reuters, BBC) from `packages/plugin-news/config/default-feeds.yml`. These are only seeded if no feeds exist yet — they won't overwrite feeds you've added.

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

### Remote Crawler (NAS Deployment)

If pi-tree itself doesn't run 24/7 (e.g. a laptop), you can offload crawling to a standalone crawler service on an always-on machine like a NAS. Run the `ghcr.io/shuowu/pi-tree-rss-crawler` image there and point pi-tree at it:

```bash
RSS_REMOTE_URL=http://your-nas:3948
```

In remote mode, pi-tree proxies all feed operations to the crawler and skips local crawling entirely. See `packages/rss-crawler/README.md` for the crawler's full API and Docker Compose setup.

### Data Storage

News data lives under `<DATA_PATH>/sources/news/`:

- `analyses/` — AI-generated news analyses (Markdown files)
- `summaries/` — AI-generated news summaries (Markdown files)

Feed metadata and cached articles are stored in the news plugin's own SQLite database at `<DATA_PATH>/plugins/news/news.db`, separate from the main `pi-tree.db`.

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
