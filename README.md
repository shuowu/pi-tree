# pi-reader

AI-assisted book reading with tree-structured conversations.

Built on top of [pi-books](../pi-books) — reads from its library, wraps the [Pi SDK](https://pi.dev/docs/latest/sdk) for AI-powered reading sessions.

## Architecture

```
packages/
  shared/    — TypeScript types shared between client and server
  server/    — Hono API server wrapping Pi SDK + tree manager
  client/    — React + Vite frontend (future: Electron desktop app)
```

## Key Concepts

- **Conversation-first**: The chat IS the reading experience. Book text is surfaced as quotes/context.
- **Tree-structured sessions**: Each book has a topic tree. Branches are created on semantic shifts (deep dive, next chapter, cross-book), not on every message.
- **Zoom in/out**: Go deeper on a concept (branch), pull back with summary (zoom out). The breadcrumb shows your depth.
- **TOC + Chat**: Navigate via clickable table of contents OR conversationally. Both work.
- **Free-form depth**: No rigid Book→Part→Chapter→Tangent hierarchy. Every node is just a topic.

## Quick Start

```bash
cp .env.example .env   # edit with your API key and paths
npm install
npm run dev
```

Server runs on `:3847`, client on `:5173`. Open http://localhost:5173.

## Docker

```bash
cp .env.example .env   # edit with your API key and ABSOLUTE paths
docker compose up --build
```

Open http://localhost:3847 (serves both frontend and API).

## Data Source

Points at `~/repos/pi-books/library/` by default. Set `LIBRARY_PATH` in `.env` to customize.
