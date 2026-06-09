# Pi-Tree

AI-assisted book reading app with tree-structured conversations.

## Architecture

Monorepo with four packages:

```
packages/
  shared/      — TypeScript types (TopicNode, Book, SessionState, UserInfo, etc.)
  extension/   — Pi Package: skills, ebook parsers, Pi extensions (publishable)
  server/      — Hono API server (tree manager, library service, Pi SDK wrapper, SQLite DB)
  client/      — React + Vite frontend (chat UI, TOC, tree panel, user picker)
```

## Docs

- `docs/ARCHITECTURE.md` — How the server wraps Pi SDK, data ownership (Pi SDK owns JSONL sessions, pi-tree owns SQLite metadata), extension package design
- `docs/SESSION-MANAGEMENT.md` — Multi-session model, context binding, session lifecycle, API reference, future agent extensibility
- `docs/SELF-HOSTING.md` — All env vars, data layout, custom skills/extensions for self-hosters, Docker Compose examples
- `docs/VISION.md` — Design philosophy and product direction

## Key Concepts

- **Conversation-first**: The AI conversation IS the reading experience
- **Multi-session per book**: Each user+book can have multiple independent sessions (reading, Q&A, custom) — each with its own conversation tree and optional context configuration
- **Tree-structured sessions**: Each session has a topic tree; branches on semantic shifts only
- **Free-form depth**: Every node is a TopicNode — no rigid hierarchy
- **TOC + Chat navigation**: Clickable table of contents alongside conversational navigation
- **Configurable summaries**: Brief/medium/detailed, per-book overrides via BOOK.md
- **Multi-user**: Each user has isolated sessions, config, glossary per book (no auth, slug-based identity)

## Server

- Hono framework (lightweight, Electron-compatible)
- TreeManager: intent classification → tree operations → Pi SDK
- DictionaryService: standalone dictionary lookup + glossary CRUD (independent from reading sessions, uses in-memory Pi SDK sessions)
- LibraryService: reads from user-configured book library on disk
- SSE streaming for real-time AI responses
- SQLite + Drizzle ORM for user/session/config/glossary metadata

## Database

SQLite via Drizzle ORM (`better-sqlite3`). DB file: `<DATA_PATH>/pi-tree.db` (default: `~/.local/share/pi-tree/`).

Tables:
- `users` — simple identity (slug id, displayName, avatarUrl)
- `user_book_sessions` — tracks Pi SDK JSONL session files per user+book. Supports multiple sessions per user+book with `title`, `context` (JSON blob of SessionContext), and `is_active` flag
- `user_book_config` — per-user per-book ReaderConfig JSON blob
- `user_book_progress` — reading position tracking
- `glossary_entries` — per-user per-book term definitions

Tables auto-created on startup (CREATE TABLE IF NOT EXISTS). Schema: `packages/server/src/db/schema.ts`.

## Client

- React + Vite (future: Electron desktop app)
- UserContext + UserPicker for user selection (stored in localStorage)
- SessionPicker for multi-session management (list, create, rename, delete sessions per book)
- Chat view with breadcrumb bar (shows active session label)
- Side panel: TOC tab + Tree tab
- Zoom in/out controls

## Data Source

Reads from `~/.local/share/pi-tree/library/` by default (configurable via `LIBRARY_PATH` env var). Users can also upload books via the UI. This is read-only.

Mutable state (sessions, DB) lives at `DATA_PATH` (default: `~/.local/share/pi-tree/`).

## Data Isolation

| Data | Location | Scope |
|------|----------|-------|
| Session JSONL | `<DATA_PATH>/sessions/<bookId>/<userId>/` | Per session per user per book |
| SQLite DB | `<DATA_PATH>/pi-tree.db` | All users |
| Session metadata | SQLite `user_book_sessions` | Per session per user per book |
| Config | SQLite `user_book_config` | Per user per book |
| Glossary | SQLite `glossary_entries` | Per user per book |
| Book content | `<LIBRARY_PATH>/<bookId>/markdown/` | Shared (read-only) |
| Outlines | `<LIBRARY_PATH>/<bookId>/analysis/` | Shared (read-only) |

## Session Management

Multiple sessions per user+book. Each session has a `SessionContext` (mode, optional skills/prompt/model overrides) stored as JSON. See `docs/SESSION-MANAGEMENT.md` for full architecture.

**Session API** (CRUD):
- `GET /api/sessions/:userId/:bookId` — list all sessions
- `POST /api/sessions/:userId/:bookId` — create `{ title, context? }`
- `PUT /api/sessions/:userId/:bookId/:sessionId` — update `{ title?, context? }`
- `DELETE /api/sessions/:userId/:bookId/:sessionId` — soft-delete

**Session interaction routes** (`/api/session/*`) all accept optional `sessionId` in request body. When omitted, defaults to most recently active session.

**URLs**:
- Sessions management: `/book/:bookId/sessions`
- Reading session: `/book/:bookId?session=<id>&node=<nodeId>`
## Multi-User Flow

No auth — users are slug-based identity records in SQLite.

**First visit**: UserPicker screen shows. Either select an existing user or create one:
- Username (slug): lowercase alphanumeric + hyphens/underscores (e.g. `shuo`)
- Display name: freeform (e.g. `Shuo`)
- Creates a row in `users` table via `POST /api/users`
- Slug + display name saved in `localStorage` (`pi-tree-user-id`, `pi-tree-display-name`)

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

Dev and Docker run on separate ports with separate databases so they can coexist:

| | Dev | Docker |
|---|---|---|
| Server port | 3947 | 3847 |
| Client port | 5947 | — (served by Hono) |
| DB path | `~/.local/share/pi-tree-dev/pi-tree.db` | `/data/pi-tree.db` (named volume) |

### Environment layering

Env vars are resolved in this order (first wins):

1. **direnv** (`.envrc`) — loads `.env` for shared secrets, then forces dev overrides (`PORT=3947`, `DATA_PATH=~/.local/share/pi-tree-dev`)
2. **dotenv** (`load-env.ts`) — fills in anything not already set from `.env` (effectively a no-op in dev since direnv already loaded everything)
3. **Hardcoded defaults** — `PORT=3847`, `DATA_PATH=~/.local/share/pi-tree` (safety net)

Docker bypasses direnv entirely — it reads `.env` via `env_file` in `docker-compose.yml`.

### Prerequisites

- **direnv**: Auto-loads `.envrc` when you `cd` into the project. Install it and add the shell hook:
  ```bash
  # Install (https://direnv.net/docs/installation.html)
  curl -sfL https://direnv.net/install.sh | bash

  # Add shell hook to ~/.bashrc (or ~/.zshrc)
  echo 'eval "$(direnv hook bash)"' >> ~/.bashrc

  # Allow the project's .envrc
  cd /path/to/pi-tree && direnv allow
  ```

### Running

```bash
npm install
npm run dev          # starts both server (:3947) and client (:5947)
npm run dev:server   # server only
npm run dev:client   # client only
```

## Docker

```bash
docker compose up --build
```

The container has `restart: unless-stopped` so it auto-starts with Docker.

Docker reads `.env` directly via `env_file` and uses `PORT=3847` as-is. The `docker-compose.yml` overrides `LIBRARY_PATH` and `DATA_PATH` for the container filesystem.

Volumes:
- `LIBRARY_PATH` (or `./library`) → `/library` (read-only content)
- `pi-tree-data` named volume → `/data` (mutable state: sessions + SQLite DB)

Env vars: `LIBRARY_PATH`, `DATA_PATH`, `PORT`, `PI_MODEL`.

