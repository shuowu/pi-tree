# pi-tree

[![CI](https://github.com/shuowu/pi-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/shuowu/pi-tree/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://github.com/shuowu/pi-tree/blob/master/LICENSE)
[![release v0.1.0](https://img.shields.io/badge/release-v0.1.1-orange)](https://github.com/shuowu/pi-tree/releases)
[![Docker Image](https://img.shields.io/badge/ghcr.io-shuowu%2Fpi--tree-blue?logo=docker)](https://github.com/shuowu/pi-tree/pkgs/container/pi-tree)

**AI makes you productive where you already understand. It confuses you where you don't.**

Ask an expert a smart question and AI will give them a brilliant answer. Ask a beginner the same question and they'll get a confident-sounding paragraph they can't evaluate. The gap between "I get this" and "I'm lost" doesn't shrink with better models — it widens. Pi-tree works on the boundary: load your books, news feeds, or research papers, and an AI reads them *with* you — not as flat Q&A, but as branching conversations that help you cross from confusion into comprehension. Go deep on a concept, branch into a tangent, zoom back out. Your reading path is a navigable tree, not a disposable chat log.

> **Local-first, bring your own key.** Runs entirely on your machine. No cloud account, no subscription. Works with cloud APIs (DeepSeek, Gemini, Claude) or fully offline with [Ollama](https://ollama.com) / local models.

<p align="center">
  <a href="https://shuowu.github.io/pi-tree/docs/features">
    <img src="docs/public/images/screenshots/library.png" alt="Pi-tree library — books, news feeds, YouTube videos, and papers in a unified reading library" width="720" />
  </a>
  <br />
  <sub><a href="https://shuowu.github.io/pi-tree/docs/features">📸 See all features</a> · <a href="https://shuowu.github.io/pi-tree/">📖 Documentation</a> · <a href="https://shuowu.github.io/pi-tree/vision">Vision</a> · <a href="CONTRIBUTING.md">Contributing</a></sub>
</p>

## Why Pi-tree?

Most AI tools help you skip past material — paste the text, get the summary, move on. That works when you already understand the domain. When you don't, skipping is exactly the problem. Pi-tree treats reading as a process worth having — one that expands what you're capable of understanding.

| | Pi-tree | ChatGPT / Claude | NotebookLM | Obsidian + AI |
|---|---|---|---|---|
| **Focus** | Comprehension & exploration | General-purpose Q&A | Document Q&A | Note-taking |
| **Conversations** | 🌳 Tree — branch, explore, return | Linear chat | Linear chat | Linear chat |
| **AI approach** | Agentic — tools & skills over local data | Prompt + context window | RAG over uploads | Plugins over local vault |
| **Sources** | Books, papers, news feeds, YouTube | File uploads, web | Multi-doc notebooks | Markdown vault |
| **Extensibility** | Skills, plugins, MCP bridge | GPTs (cloud-hosted) | None | Community plugins |
| **Model choice** | BYOK — any provider or local | Vendor-locked | Google only | Plugin-dependent |
| **Data** | Local-first, self-hosted | Cloud | Cloud | Local |

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

## What You Can Read

Pi-tree supports four source types, each handled by a dedicated [plugin](#plugin-architecture):

📚 **Books** — Upload EPUB, MOBI, PDF, or Markdown. The AI guides you chapter by chapter with reading skills, structural analysis, and branching discussions. Multiple session modes: guided reading, freeform Q&A, or deep analysis.

📰 **News Feeds** — Add RSS/Atom feeds. Pi-tree crawls and deduplicates articles, then lets you scan trends, deep-dive into stories, and discuss the news with AI. Comes with its own dashboard and feed management.

📄 **Research Papers** — Search arXiv directly from the chat. Fetch papers, read them with AI-provided context, and branch into methodology questions or related work.

🎥 **YouTube Videos** — Paste a link. Pi-tree extracts the transcript and video metadata, then lets you discuss the content — quote specific segments, ask follow-ups, compare with other sources. Includes an embedded video player.

> [!IMPORTANT]
> Users are responsible for ensuring they have the right to use any content loaded into pi-tree. This project does not distribute, host, or provide access to any copyrighted material.

## Who Is This For?

- 📚 **Nonfiction readers** — you're reading a dense chapter and AI summaries skip the part you actually don't understand. Pi-tree stays in that gap with you until you do.
- 🎓 **Researchers & students** — you're outside your subfield and every paper assumes background you lack. Branch into what you don't know, then return to the argument.
- 📰 **News followers** — you read the headline but can't evaluate the claim. Turn feeds into conversations where you build context over time, not scroll past it.
- 🔧 **Developers** — you're in an unfamiliar codebase or domain. Build [custom plugins](https://shuowu.github.io/pi-tree/docs/examples) to explore anything conversationally.

## Getting Started

### Docker (recommended)

```bash
cp .env.example .env   # edit with your API key

docker run -d --name pi-tree \
  --env-file .env \
  -p 3847:3847 \
  -v ~/.local/share/pi-tree:/data \
  ghcr.io/shuowu/pi-tree:latest
```

Open http://localhost:3847 (serves both frontend and API).

> [!TIP]
> Full setup options → [Self-hosting guide](https://shuowu.github.io/pi-tree/docs/self-hosting#docker)

### From Source

```bash
cp .env.example .env   # edit with your API key and provider
npm install
npm run dev
```

Dev server runs on `:3947`, client on `:5947`. Open http://localhost:5947.

### Desktop App ⚠️ Experimental

Download from the [**Releases page**](https://github.com/shuowu/pi-tree/releases/latest) — available for macOS, Linux, and Windows. No Node.js, no Docker, no terminal needed.

Open the app, enter an API key (or point to a local Ollama server), and start reading.

## Models

Pi-tree doesn't need frontier-class models — reading and comprehension are more about context and conversation than raw reasoning. Smaller, faster models work well and keep costs low (or free with local inference).

| Provider | Model | Notes |
|----------|-------|-------|
| DeepSeek | `deepseek-v4-flash` | Very cheap, strong reading comprehension |
| Google | `gemini-2.5-flash` | Fast, large context window |
| Anthropic | `claude-haiku-4-20250514` | Fast, great quality-to-cost ratio |
| Zhipu | `glm-5-turbo` | Good Chinese + English bilingual support |

**Local models** — completely offline, no API costs. Use [Ollama](https://ollama.com/download) or [LM Studio](https://lmstudio.ai/). Gemma 4 (12B) and Qwen 3.6 are good starting points.

> [!TIP]
> Multi-provider setup, runtime switching, compatibility flags → [Models & Providers](https://shuowu.github.io/pi-tree/docs/models)

## How It Works

Built on the [Pi SDK](https://pi.dev/docs/latest/sdk) — a minimalist AI agent framework with tree-structured conversations.

### Plugin architecture

Each source type ships as a self-contained **plugin** — an independent package with its own tools, skills, session profiles, and (optionally) HTTP routes and UI components. The server discovers plugins at startup and wires their capabilities into the right sessions.

| Plugin | Source Type | What it provides |
|--------|------------|-----------------|
| `plugin-book` | Books | EPUB/MOBI/PDF parsing, guided reading, analysis, outline generation |
| `plugin-news` | News | RSS crawling, feed management, news discussion (own database) |
| `plugin-paper` | Papers | arXiv search, paper fetching, research reading |
| `plugin-youtube` | YouTube | Transcript extraction, video info, embedded player |
| `plugin-mcp` | — | Bridges external [MCP servers](https://modelcontextprotocol.io) (web search, etc.) |

Plugins depend only on `@pi-tree/plugin-sdk` — they can't access server internals. Each plugin declares a manifest in `package.json` that tells the server what source type it handles, which tools and skills it provides, and what routes to mount.

### Three levels of customization

You don't need to build a plugin to extend pi-tree. There are three tiers, from zero-code to full package:

1. **Custom skills** (no code) — Drop a `SKILL.md` into `$DATA_PATH/skills/` to change how the AI reads, discusses, or analyzes any source type. Override built-in skills by name, or add new ones.
2. **Custom profiles + extensions** (no plugin) — Add a YAML profile and a tool extension to `$DATA_PATH/` to create an entirely new source type. The [self-hosting guide](https://shuowu.github.io/pi-tree/docs/self-hosting#custom-source-types) walks through a complete example.
3. **Full plugin package** — For source types that need parsers, databases, HTTP routes, or UI panels. See the [plugin guide](https://shuowu.github.io/pi-tree/docs/examples).

### Other key choices

- **Session profiles** — declarative YAML files map each `(sourceType, mode)` to specific skills and tools. Audit them, override them, [create your own](https://shuowu.github.io/pi-tree/docs/self-hosting#custom-session-profiles)
- **Data separation** — Pi SDK owns conversation content (JSONL files); pi-tree owns metadata (SQLite: users, sessions, config, glossary)
- **Multi-user** — each user gets isolated sessions, config, and glossary per source

> [!TIP]
> Architecture deep dive, custom skills, plugin development → [Documentation](https://shuowu.github.io/pi-tree/docs/architecture)

## Security & Privacy

Pi-tree is local-first — no cloud accounts, no telemetry, no phone-home. API keys are stored on your filesystem and sent only to your chosen provider.

- 🛡️ **Session-scoped permissions** — Each session type declares exactly which tools the agent can use. A book reading session gets 5-8 purpose-built tools. No shell. No file editing. No database writes.
- 📝 **Declarative profiles** — Capabilities are configured in YAML. `exclude_tools: [bash, edit]` is the default for all user-facing sessions. Audit them, override them, create your own.
- 📡 **Fully offline** — Pair with [Ollama](https://ollama.com) for air-gapped operation. No internet required.
- 📖 **Open source** — AGPL-3.0. Audit the code, fork it, self-host it.

Pi-tree's agent is a **reading companion**, not a general-purpose agent. The permission model reflects that — minimal surface area, scoped by purpose, auditable by design.

## Design Philosophy

More on why pi-tree exists → [Vision](https://shuowu.github.io/pi-tree/vision)

The short version: AI accelerates people inside their circle of competence and bewilders them outside it. Pi-tree is built to push that circle outward. Every design decision — tree-structured conversations, persistent context, branching exploration, per-source glossaries — serves a single purpose: turning material you *can't yet* evaluate into material you can.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
