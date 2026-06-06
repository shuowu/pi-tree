# pi-books

AI-assisted book reading with tree-structured conversations. Upload your own books (EPUB, MOBI, PDF) or point at a local collection, then explore them through AI-powered chat with branching topic trees.

> **Bring Your Own Key** — pi-books runs locally. You provide your own LLM API key. No data leaves your machine except API calls to your chosen provider.

## Why

I started reading with AI in the terminal — using [Pi](https://pi.dev), a minimalist AI agent that gives you total freedom. No menus, no preset workflows, just a conversation tree and your curiosity. It was the best reading experience I'd ever had. But it was also mine alone — no one else in my family could use a terminal tool, and that felt like a waste. The power of AI-assisted reading shouldn't require a developer's setup.

At the same time, most AI apps go the other direction: they box you into the builder's vision of how things should work. Pi-books tries to find the middle ground — a real UI that anyone can pick up, built on the same minimalist, tree-structured conversation model that makes the terminal experience so powerful.

I also believe AI is heading toward specialization: not one model that does everything, but focused tools that each do one thing exceptionally well. Pi-books is that kind of tool — it doesn't try to be a general chatbot. It's a **reading companion**, and every design decision serves that single purpose. And it runs entirely on your machine — your books, your data, your API keys never leave your control. As local AI models get better, you won't even need a cloud API; plug in Ollama or any local provider, and the whole experience stays offline and private.

*Read more about the design philosophy → [docs/VISION.md](docs/VISION.md)*

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

Built on the [Pi SDK](https://pi.dev/docs/latest/sdk) for AI-powered reading sessions. The extension package can also be installed in the [Pi terminal](https://pi.dev) for book reading from the CLI.

*Architecture deep dive → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)*
*Self-hosting, Docker, custom skills → [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)*

## Quick Start

```bash
cp .env.example .env   # edit with your API key and provider
npm install
npm run dev
```

Dev server runs on `:3947`, client on `:5947`. Open http://localhost:5947.

Dev uses a separate database (`~/.local/share/pi-books-dev/`) so it never collides with Docker. Overrides live in `.env.dev` (auto-created, gitignored).

You'll need an API key from a supported LLM provider (Anthropic, OpenAI, Google, DeepSeek, Zhipu, etc). See `.env.example` for details.

## Docker

```bash
cp .env.example .env   # edit with your API key and ABSOLUTE paths
docker compose up --build
```

Open http://localhost:3847 (serves both frontend and API).

## Book Content

Pi-books is a **reading tool** — no book content is included in this repository.

You can add books in two ways:
1. **Upload** via the Library UI (supports EPUB, MOBI, PDF)
2. **Local folder** — set `LIBRARY_PATH` in `.env` to point at your book collection

> [!IMPORTANT]
> Users are responsible for ensuring they have the right to use any content loaded into pi-books. This project does not distribute, host, or provide access to any copyrighted material.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
