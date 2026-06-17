# pi-tree

[![CI](https://github.com/shuowu/pi-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/shuowu/pi-tree/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/shuowu/pi-tree/blob/master/LICENSE)
[![release v0.2.0](https://img.shields.io/badge/release-v0.2.1-orange)](https://github.com/shuowu/pi-tree/releases)
[![Docker Image](https://img.shields.io/badge/ghcr.io-shuowu%2Fpi--tree-blue?logo=docker)](https://ghcr.io/shuowu/pi-tree)

**AI made everyone a faster producer. Nobody's becoming a better reader.**

Pi-tree is for the input side of knowledge work. Load your books, news feeds, or research papers — an AI reads them *with* you, not as a flat Q&A, but as branching conversations that capture how you actually think about the material. Go deep on a concept, branch into a tangent, zoom back out. Your reading path is a navigable tree, not a disposable chat log.

> **Local-first, bring your own key.** Runs entirely on your machine. No cloud account, no subscription. Works with cloud APIs (DeepSeek, Gemini, Claude) or fully offline with [Ollama](https://ollama.com) / local models.

<p align="center">
  <a href="https://shuowu.github.io/pi-tree/">
    <img src="docs/images/demo.gif" alt="Pi-tree in action — scrolling through an AI-generated news summary, tree sidebar with branching topics, inline branch cards for deep-dive" width="720" />
  </a>
  <br />
  <sub><a href="https://shuowu.github.io/pi-tree/">📖 Documentation</a> · <a href="https://shuowu.github.io/pi-tree/vision">Vision</a> · <a href="https://shuowu.github.io/pi-tree/">▶ Watch Demo</a> · <a href="CONTRIBUTING.md">Contributing</a></sub>
</p>

## Why Pi-tree?

Most AI tools treat reading as a problem to skip past — paste the text, get the summary, move on. Pi-tree treats reading as a process worth having.

| | Pi-tree | ChatGPT / Claude | NotebookLM | Obsidian + AI |
|---|---|---|---|---|
| **Focus** | Comprehension & exploration | General-purpose Q&A | Document Q&A | Note-taking |
| **Conversation shape** | 🌳 Tree — branch, explore, return | Linear chat | Linear chat | Linear chat |
| **Persistence** | Long-term reading companion | Session-oriented | Project-scoped | Manual |
| **Model choice** | BYOK — any provider or local | Vendor-locked | Google only | Plugin-dependent |
| **Data ownership** | Local-first, your files | Cloud | Cloud | Local |

### What a session looks like

```
📖 Reading: Thinking, Fast and Slow (Kahneman)

Root
├── What is System 1 vs System 2?
│   ├── How does this relate to cognitive biases?
│   │   └── Anchoring bias deep-dive
│   └── Real-world examples in decision making
├── Chapter 3: The Lazy Controller
│   └── Why do we avoid effortful thinking?
└── Comparison with Nassim Taleb's ideas
    ├── Black Swan connection
    └── Antifragility and heuristics
```

Each node is a conversation branch with full context. Go deep on any concept, then navigate back to explore something else — no context lost.

### Why trees work better for LLMs

The tree structure isn't just a UX choice — it makes the AI better.

In a linear chat, every message you've ever sent is packed into the context window. After 30 turns spanning three different topics, the model is trying to track everything at once — and starts hallucinating, losing the thread, or ignoring your latest question in favor of something from 20 messages ago.

Trees fix this at the architecture level:

- **Focused context** — Each branch carries only its path from root to current node. When you're exploring cognitive biases, the model doesn't see your earlier tangent about Nassim Taleb. Less noise → more accurate responses.
- **Token savings** — A 50-message linear chat sends all 50 messages every turn. A tree with 5 branches of 10 messages sends only ~10. Fewer tokens per request → lower cost, faster responses.
- **Less hallucination** — Context pollution is a primary cause of hallucination in long conversations. Isolated branches mean the model stays grounded in the relevant thread.
- **Longer effective conversations** — Linear chats degrade in quality well before hitting the context window limit. Trees keep each branch short and focused, so you can explore a source across hundreds of messages without quality loss.

## Who Is This For?

- 📚 **Serious nonfiction readers** — turn passive reading into active conversation
- 🎓 **Researchers & graduate students** — work through papers with persistent context
- 📰 **News followers** — RSS feeds become conversational sources, not scroll fodder
- 🧠 **PKM enthusiasts** — tree-structured conversations as a knowledge building primitive
- 🔧 **Developers** — explore codebases conversationally with [custom extensions](https://shuowu.github.io/pi-tree/docs/examples)

## Security & Privacy

Pi-tree is local-first — no cloud accounts, no telemetry, no phone-home. API keys are stored on your filesystem and sent only to your chosen provider. Pair with [Ollama](https://ollama.com) for fully air-gapped operation.

But "local" isn't the interesting part. The interesting part is how the AI agent's capabilities are controlled.

### Agent permission model

Most AI agent tools give the model broad access — shell execution, filesystem writes, network calls — and rely on the user to supervise. Pi-tree takes the opposite approach: **each session type declares exactly which tools the agent can use**, and everything else is blocked.

```yaml
# Session profile: book.reading
skills: [interactive-reading]     # markdown instructions — what the agent knows
extensions: [mcp]                 # tool bundles — what the agent can do
exclude_tools: [bash, edit]       # explicit blocklist — what the agent cannot do
```

A book reading session gets the `interactive-reading` skill (how to guide a reading conversation) and nothing else. No shell. No file editing. No database writes. A news session adds the `news` extension (RSS tools), but still no shell. The agent's tool surface is **5-8 purpose-built tools per session**, not hundreds.

This is configured via [declarative session profiles](https://shuowu.github.io/pi-tree/docs/architecture) — you can audit, override, or create your own.

### Built-in extensions vs MCP tools

Pi-tree has two kinds of agent capabilities, with different trust levels:

| | Built-in extensions | MCP tools |
|---|---|---|
| **Examples** | `library` (browse sources), `news` (RSS feeds) | Web search, translation, academic DBs |
| **Code** | In the repo — auditable, PR-reviewed | External processes, user-configured |
| **DB access** | Scoped to 3 tables via service locator | None — no access to pi-tree internals |
| **Network** | Only explicit endpoints (arXiv, Jina Reader) | Whatever the MCP server provides |
| **Namespace** | Flat (`list_sources`, `search_rss`) | Prefixed (`mcp_brave_web_search`) |
| **Control** | Remove from profile YAML | Add/remove in `mcp.json`, or `disabled: true` |

MCP tools are **opt-in** — they do nothing unless you configure `$DATA_PATH/mcp.json`. When configured, each tool is namespace-prefixed and can be individually excluded via `exclude_tools`.

### Compared to other agentic tools

| | Pi-tree | Computer-use agents | Coding agents |
|---|---|---|---|
| **Shell access** | Blocked by default | Unrestricted | Unrestricted |
| **File writes** | Blocked by default | Full desktop | Full repo |
| **Tool surface** | 5-8 tools per session | Hundreds of desktop actions | 10-15 code tools |
| **Scope** | Per-session, per-source-type | Global desktop | Per-workspace |
| **Philosophy** | Allowlist: only what's declared | Maximum capability | Maximum capability |

Pi-tree's agent is a **reading companion**, not a general-purpose agent. The permission model reflects that — minimal surface area, scoped by purpose, auditable by design.


## Getting Started

### Desktop App (easiest)

Download from the [**Releases page**](https://github.com/shuowu/pi-tree/releases/latest) — available for macOS, Linux, and Windows. No Node.js, no Docker, no terminal needed.

Open the app, enter an API key (or point to a local Ollama server), and start reading.

### Docker

```bash
cp .env.example .env   # edit with your API key

docker run -d --name pi-tree \
  --env-file .env \
  -p 3847:3847 \
  -v pi-tree-data:/data \
  ghcr.io/shuowu/pi-tree:latest
```

Open http://localhost:3847 (serves both frontend and API).

> [!TIP]
> Full setup options → [Docker guide](https://shuowu.github.io/pi-tree/docs/docker)

### From Source

```bash
cp .env.example .env   # edit with your API key and provider
npm install
npm run dev
```

Dev server runs on `:3947`, client on `:5947`. Open http://localhost:5947.

## Models

Pi-tree doesn't need frontier-class models — reading and comprehension are more about context and conversation than raw reasoning. Smaller, faster models work well and keep costs low (or free with local inference).

**Cloud APIs** (cheapest options that work well):

| Provider | Model | Notes |
|----------|-------|-------|
| DeepSeek | `deepseek-v4-flash` | Very cheap, strong reading comprehension |
| Google | `gemini-2.5-flash` | Fast, large context window |
| Anthropic | `claude-haiku-4-20250514` | Fast, great quality-to-cost ratio |
| Zhipu | `glm-5-turbo` | Good Chinese + English bilingual support |

**Local models** — completely offline, no API costs. Use [Ollama](https://ollama.com/download) or [LM Studio](https://lmstudio.ai/). Gemma 4 (12B) and Qwen 3.6 are good starting points.

```bash
PI_PROVIDER=openai                              # Ollama/LM Studio expose an OpenAI-compatible API
PI_API_KEY=not-needed
PI_BASE_URL=http://localhost:11434/v1            # Ollama default
PI_MODEL=gemma4:12b
```

> [!TIP]
> Multiple providers, runtime switching, and more → [Models & Providers](https://shuowu.github.io/pi-tree/docs/models)

## Content Sources

Pi-tree supports multiple source types. No content is included in this repository.

- **Books** — upload via the Library UI (EPUB, MOBI, PDF)
- **News feeds** — add RSS/Atom feeds through the UI; pi-tree crawls, deduplicates, and presents them as conversational sources

> [!IMPORTANT]
> Users are responsible for ensuring they have the right to use any content loaded into pi-tree. This project does not distribute, host, or provide access to any copyrighted material.

## How It Works

Built on the [Pi SDK](https://pi.dev/docs/latest/sdk) — a minimalist AI agent framework with tree-structured conversations. Pi-tree serves as a real-world reference application demonstrating local-first AI, BYOK model abstraction, MCP tool integration, and multi-provider support.

```
packages/
  core/      — Pure library: PiSession, TreeManager, model setup, types
  ui/        — React component library: ChatView, Breadcrumb, InlineBranches
  server/    — Hono API server: routes, config, DB, agents (skills + extensions)
  client/    — React + Vite frontend: pages, panels, app-specific wiring
  electron/  — Desktop app: wraps server + client in Electron
```

Key architectural choices:
- **Server is thin** — receives a message, passes it to a Pi SDK session with source context, streams the response back via SSE
- **Skills shape behavior** — markdown instruction files control how the AI interacts with each source type. Change a SKILL.md, change the behavior — no code changes needed
- **Data separation** — Pi SDK owns conversation content (JSONL files); pi-tree owns metadata (SQLite: users, sessions, config, glossary)
- **MCP bridge** — connect external MCP servers (web search, academic databases, etc.) without writing code

> [!TIP]
> Architecture deep dive, custom skills, extensions, MCP setup → [Documentation](https://shuowu.github.io/pi-tree/docs/architecture)

## Design Philosophy

More on why pi-tree exists → [Vision](https://shuowu.github.io/pi-tree/vision)

The short version: the AI industry is focused on **output** — helping you produce things faster. Pi-tree is focused on **input** — helping you understand things deeper. Every design decision (tree-structured conversations, persistent context, branching exploration, per-source glossaries) serves that single purpose: making information ingestion a richer experience, not a faster one.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
