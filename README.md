# pi-books

AI-assisted book reading with tree-structured conversations. Upload your own books (EPUB, MOBI, PDF) or point at a local collection, then explore them through AI-powered chat with branching topic trees.

> **Bring Your Own Key** — pi-books runs locally. You provide your own LLM API key. No data leaves your machine except API calls to your chosen provider.

## Why

### Why Pi

[Pi](https://pi.dev) is a minimalist AI agent — no menus, no preset workflows, just a conversation tree and your curiosity. What makes it special for reading is the **tree-structured session model**: every conversation is a tree of topics, not a flat chat log. You can branch into a tangent — *"how does this connect to what I read last week?"* — and the branch preserves full context. Zoom back out without losing your place. The tree becomes a map of how you actually think about the material.

Most AI chat tools give you a linear thread that grows until you start a new one. Pi gives you a persistent, navigable structure — and that's the foundation pi-books is built on.

### Why a GUI

The terminal version of Pi for reading was genuinely the best way I'd ever read a non-fiction book. But it was also mine alone — no one else in my family could use a terminal tool, and that felt like a waste.

As *The Pragmatic Programmer* puts it:

> *"A benefit of GUIs is WYSIWYG — what you see is what you get. The disadvantage is WYSIAYG — what you see is **all** you get."*

Most AI apps fall into this trap: they build a polished GUI but box you into the builder's vision of how things should work. You get preset workflows, fixed layouts, and interaction patterns that work for the demo but break for real use.

Pi-books tries to find the middle ground: a real GUI that anyone can pick up — my wife, my kids, my parents, anyone curious about ideas — built on the same minimalist, tree-structured model that makes the terminal experience so powerful. The UI makes the tree *visible* and *clickable* (TOC, breadcrumbs, branch navigation) without imposing a rigid structure on how you read.

### Why Local-First

Pi-books runs entirely on your machine. No cloud backend, no account to create, no subscription gating your reading. Your books, sessions, conversations, and glossaries never leave your control.

This isn't just a privacy feature — it's about **ownership**. You pick the AI model. You pick the provider. You control the cost. Point it at [Ollama](https://ollama.com) or any OpenAI-compatible local server, and the whole experience runs offline — no tokens metered, no API costs, no data leaving your network.

Reading is intimate. The questions you ask about a book — the tangents you explore, the connections you draw — reveal how you think. That data shouldn't live on someone else's infrastructure.

### Specialization Over Generalization

ChatGPT, Claude, Gemini can all summarize a book — but they do it in a flat, sessionless way. Context resets. There's no *structure*. Pi-books is a **reading companion**, not a general chatbot with books bolted on. Every design decision — tree structure, branching conversations, zoom controls, per-book glossaries — serves that single purpose.

*Read more about the design philosophy → [docs/VISION.md](docs/VISION.md)*

### Who is this for

- Non-fiction readers who want to go deeper than highlights and summaries
- Families and book clubs — everyone gets their own conversation tree for the same book
- Privacy-conscious readers who don't want their reading habits on someone else's server
- Self-hosters and tinkerers who want full control over their tools

## Key Concepts

- **Conversation-first**: The chat IS the reading experience. Book text is surfaced as quotes/context.
- **Tree-structured sessions**: Each book has a topic tree. Branches are created on semantic shifts (deep dive, next chapter, cross-book), not on every message.
- **Zoom in/out**: Go deeper on a concept (branch), pull back with summary (zoom out). The breadcrumb shows your depth.
- **TOC + Chat**: Navigate via clickable table of contents OR conversationally. Both work.
- **Free-form depth**: No rigid Book→Part→Chapter→Tangent hierarchy. Every node is just a topic.
- **Multi-user**: Slug-based user identity — each user gets isolated sessions, config, and glossary per book.

## Architecture

```
packages/
  shared/      — TypeScript types shared between client and server
  extension/   — Pi Package: skills, ebook parsers, Pi extensions (publishable)
  server/      — Hono API server wrapping Pi SDK + tree manager
  client/      — React + Vite frontend
```

Built on the [Pi SDK](https://pi.dev/docs/latest/sdk). The same `extension` package powers both the GUI and the [Pi terminal](https://pi.dev) — install it as a Pi Package for CLI reading, or use it through pi-books for the full GUI experience.

*Architecture deep dive → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)*
*Self-hosting, Docker, custom skills → [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)*

## Getting Started

### Local setup (no Docker)

Prerequisites: [Node.js](https://nodejs.org/) 22+, npm.

```bash
cp .env.example .env   # edit with your API key and provider
npm install
npm run dev
```

Dev server runs on `:3947`, client on `:5947`. Open http://localhost:5947.

Dev uses a separate database (`~/.local/share/pi-books-dev/`) so it never collides with Docker.

### Docker

```bash
cp .env.example .env   # edit with your API key and ABSOLUTE paths
docker compose up --build
```

Open http://localhost:3847 (serves both frontend and API).

*Full env vars, volumes, custom skills → [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)*

## Models

Pi-books doesn't need frontier-class models — book reading is more about context and conversation than raw reasoning. Smaller, faster models work well and keep costs low (or free with local inference).

**Cloud APIs** (cheapest options that work well):

| Provider | Model | Notes |
|----------|-------|-------|
| DeepSeek | `deepseek-v4-flash` | Very cheap, strong reading comprehension |
| Google | `gemini-2.5-flash` | Fast, large context window |
| Anthropic | `claude-haiku-4-20250514` | Fast, great quality-to-cost ratio |
| Zhipu | `glm-5-turbo` | Good Chinese + English bilingual support |

**Local models** — completely offline, no API costs. Use [Ollama](https://ollama.com/download) or [LM Studio](https://lmstudio.ai/) to run models locally. Gemma 4 (12B, 256K context) and Qwen 3.6 are good starting points — explore what works for your hardware and reading language.

Point pi-books at your local server in `.env`:

```bash
PI_PROVIDER=openai                              # Ollama/LM Studio expose an OpenAI-compatible API
PI_API_KEY=not-needed
PI_BASE_URL=http://localhost:11434/v1            # Ollama default (LM Studio: http://localhost:1234/v1)
PI_MODEL=gemma4:12b
```

**Multiple providers** — for advanced setups (e.g., Ollama for offline + DeepSeek for cloud), use Pi's native [`models.json`](https://pi.dev/docs/latest/models) config at `~/.pi/agent/models.json`. Env vars and `models.json` merge automatically — you can use both.

> [!TIP]
> You can also change models at runtime through the Settings UI — no restart needed.

## Book Content

Pi-books is a **reading tool** — no book content is included in this repository.

You can add books in two ways:
1. **Upload** via the Library UI (supports EPUB, MOBI, PDF)
2. **Local folder** — set `LIBRARY_PATH` in `.env` to point at your book collection

> [!IMPORTANT]
> Users are responsible for ensuring they have the right to use any content loaded into pi-books. This project does not distribute, host, or provide access to any copyrighted material.

## Extensions

Pi-books supports custom **skills** (markdown instruction files that shape AI behavior) and **extensions** (TypeScript modules that add tools and commands). 11 reading skills are built in.

Pi-books is built on [Pi](https://pi.dev), so any Pi-compatible extension works here. One worth adding:

```bash
pi install npm:pi-web-search    # gives the AI web search during reading sessions
```

This lets the AI look up references, author background, or related concepts while you read — without leaving the conversation.

> [!NOTE]
> Extension documentation is a work in progress. See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) for the current skill and extension format.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
