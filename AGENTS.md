# Pi-Books

AI-assisted book reading app with tree-structured conversations.

## Architecture

Monorepo with three packages:

```
packages/
  shared/    — TypeScript types (TopicNode, Book, SessionState, UserInfo, etc.)
  server/    — Hono API server (tree manager, library service, Pi SDK wrapper, SQLite DB)
  client/    — React + Vite frontend (chat UI, TOC, tree panel, user picker)
```

## Key Concepts

- **Conversation-first**: The AI conversation IS the reading experience
- **Tree-structured sessions**: Each book has a topic tree; branches on semantic shifts only
- **Free-form depth**: Every node is a TopicNode — no rigid hierarchy
- **TOC + Chat navigation**: Clickable table of contents alongside conversational navigation
- **Configurable summaries**: Brief/medium/detailed, per-book overrides via BOOK.md
- **Multi-user**: Each user has isolated sessions, config, glossary per book (no auth, slug-based identity)

## Server

- Hono framework (lightweight, Electron-compatible)
- TreeManager: intent classification → tree operations → Pi SDK
- DictionaryService: standalone dictionary lookup + glossary CRUD (independent from reading sessions, uses in-memory Pi SDK sessions)
- LibraryService: reads from pi-library library on disk
- SSE streaming for real-time AI responses
- SQLite + Drizzle ORM for user/session/config/glossary metadata

## Database

SQLite via Drizzle ORM (`better-sqlite3`). DB file: `<DATA_PATH>/pi-books.db` (default: `~/.local/share/pi-books/`).

Tables:
- `users` — simple identity (slug id, displayName, avatarUrl)
- `user_book_sessions` — tracks Pi SDK JSONL session files per user+book
- `user_book_config` — per-user per-book ReaderConfig JSON blob
- `user_book_progress` — reading position tracking
- `glossary_entries` — per-user per-book term definitions

Tables auto-created on startup (CREATE TABLE IF NOT EXISTS). Schema: `packages/server/src/db/schema.ts`.

## Client

- React + Vite (future: Electron desktop app)
- UserContext + UserPicker for user selection (stored in localStorage)
- Chat view with breadcrumb bar
- Side panel: TOC tab + Tree tab
- Zoom in/out controls

## Data Source

Reads from `~/repos/pi-library/library/` (configurable via `LIBRARY_PATH` env var). This is read-only.

Mutable state (sessions, DB) lives at `DATA_PATH` (default: `~/.local/share/pi-books/`).

## Data Isolation

| Data | Location | Scope |
|------|----------|-------|
| Session JSONL | `<DATA_PATH>/sessions/<bookId>/<userId>/` | Per user per book |
| SQLite DB | `<DATA_PATH>/pi-books.db` | All users |
| Session metadata | SQLite `user_book_sessions` | Per user per book |
| Config | SQLite `user_book_config` | Per user per book |
| Glossary | SQLite `glossary_entries` | Per user per book |
| Book content | `<LIBRARY_PATH>/<bookId>/markdown/` | Shared (read-only) |
| Outlines | `<LIBRARY_PATH>/<bookId>/analysis/` | Shared (read-only) |
## Multi-User Flow

No auth — users are slug-based identity records in SQLite.

**First visit**: UserPicker screen shows. Either select an existing user or create one:
- Username (slug): lowercase alphanumeric + hyphens/underscores (e.g. `shuo`)
- Display name: freeform (e.g. `Shuo`)
- Creates a row in `users` table via `POST /api/users`
- Slug + display name saved in `localStorage` (`pi-books-user-id`, `pi-books-display-name`)

**Returning visit**: Auto-reads from localStorage → skips UserPicker → straight to Library.

**Switch user**: Click user pill in Library header → clears localStorage → back to UserPicker.

**Auto-create on session**: If a session endpoint receives a userId that doesn't exist in DB, `TreeManager.ensureUser()` auto-creates a user row (backward compat / robustness).

**User API**:
- `GET /api/users` — list all
- `POST /api/users` — create `{ id, displayName }`
- `GET /api/users/:userId` — get one
- `PUT /api/users/:userId` — update `{ displayName?, avatarUrl? }`
- `DELETE /api/users/:userId` — delete + cascade all related data

## Development

```bash
npm install
npm run dev          # starts both server (:3847) and client (:5847)
npm run dev:server   # server only
npm run dev:client   # client only
```

## Docker

```bash
docker compose up --build
```

Volumes:
- `LIBRARY_PATH` (or `./library`) → `/library` (read-only content)
- `pi-books-data` named volume → `/data` (mutable state: sessions + SQLite DB)

Env vars: `LIBRARY_PATH`, `DATA_PATH`, `PORT`, `PI_MODEL`.
