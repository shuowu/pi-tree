# Pi-Reader

AI-assisted book reading app with tree-structured conversations.

## Architecture

Monorepo with three packages:

```
packages/
  shared/    — TypeScript types (TopicNode, Book, SessionState, etc.)
  server/    — Hono API server (tree manager, library service, Pi SDK wrapper)
  client/    — React + Vite frontend (chat UI, TOC, tree panel)
```

## Key Concepts

- **Conversation-first**: The AI conversation IS the reading experience
- **Tree-structured sessions**: Each book has a topic tree; branches on semantic shifts only
- **Free-form depth**: Every node is a TopicNode — no rigid hierarchy
- **TOC + Chat navigation**: Clickable table of contents alongside conversational navigation
- **Configurable summaries**: Brief/medium/detailed, per-book overrides via BOOK.md

## Server

- Hono framework (lightweight, Electron-compatible)
- TreeManager: intent classification → tree operations → Pi SDK
- LibraryService: reads from pi-books library on disk
- SSE streaming for real-time AI responses

## Client

- React + Vite (future: Electron desktop app)
- Chat view with breadcrumb bar
- Side panel: TOC tab + Tree tab
- Zoom in/out controls

## Data Source

Reads from `~/repos/pi-books/library/` (configurable via LIBRARY_PATH env var).

## Development

```bash
npm install
npm run dev          # starts both server (:3001) and client (:5173)
npm run dev:server   # server only
npm run dev:client   # client only
```
