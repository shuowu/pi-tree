# Self-Hosting Setup

This guide covers configuration, customization, and extending pi-books for self-hosted deployments.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_PROVIDER` | — | LLM provider name (`anthropic`, `openai`, `google`, `zhipu`, `deepseek`, etc.) |
| `PI_API_KEY` | — | API key for your provider |
| `PI_BASE_URL` | — | Custom base URL (for proxies or self-hosted models) |
| `PI_MODEL` | — | Model ID for reading sessions (e.g., `claude-sonnet-4-20250514`) |
| `PI_LOOKUP_MODEL` | — | Model ID for dictionary lookups (can be a cheaper/faster model) |
| `LIBRARY_PATH` | `~/.local/share/pi-books/library` | Path to your book library (read-only) |
| `DATA_PATH` | `~/.local/share/pi-books` | Mutable state: sessions, database, user skills |
| `SKILLS_PATH` | `<DATA_PATH>/skills` | Custom skills directory |
| `EXTENSIONS_PATH` | `<DATA_PATH>/extensions` | Custom extensions directory |
| `PORT` | `3847` | Server port |

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
<DATA_PATH>/                          # ~/.local/share/pi-books by default
├── pi-books.db                       # SQLite database (users, sessions, config)
├── sessions/                         # Pi SDK session JSONL files
│   └── <bookId>/<userId>/            # Per-user per-book sessions
├── books/                            # Uploaded books (from UI)
│   └── <bookId>/
│       ├── original.epub             # Source file
│       ├── markdown/                 # Converted markdown
│       ├── analysis/                 # AI-generated outlines
│       └── cover.jpg                 # Cover image
├── skills/                           # ← Your custom skills go here
│   └── my-skill/
│       └── SKILL.md
├── extensions/                       # ← Your custom extensions go here
│   └── my-extension/
│       └── index.ts
└── global-config.json                # Runtime config overrides (from Settings UI)
```

## Custom Skills

Skills are markdown instruction files that shape how the AI behaves during reading sessions. Pi-books ships with 11 built-in skills (in `packages/extension/skills/`). You can add your own.

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

### How skills are discovered

On each new reading session, the server scans:

1. `packages/extension/skills/` — built-in skills (shipped with the app)
2. `.pi/skills/` — project-local skills (if running from source)
3. `<DATA_PATH>/skills/` — user skills (customizable at runtime)
4. `<SKILLS_PATH>/` — override via environment variable

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

## Docker Compose

### Basic setup

```yaml
services:
  pi-books:
    build: .
    ports:
      - "3847:3847"
    environment:
      - PI_PROVIDER=anthropic
      - PI_API_KEY=${PI_API_KEY}
      - PI_MODEL=claude-sonnet-4-20250514
    volumes:
      - ./library:/library:ro          # your books (read-only)
      - pi-books-data:/data            # mutable state

volumes:
  pi-books-data:
```

### With custom skills

Mount a host directory into the data volume's skills path:

```yaml
services:
  pi-books:
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
      - pi-books-data:/data
      - ./my-skills:/data/skills:ro        # your custom skills
      - ./my-extensions:/data/extensions:ro # your custom extensions

volumes:
  pi-books-data:
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
