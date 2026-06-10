# Pi-Tree

AI-assisted reading and research app with tree-structured conversations. Supports multiple source types: books, news feeds, papers, and more.

## Architecture

Monorepo with four packages:

```
packages/
  core/        — Pure library: PiSession, TreeManager, model-setup, types (no env vars, no fs)
  ui/          — React component library: ChatView, Breadcrumb, InlineBranches (pit-* namespaced)
  server/      — Hono API server (routes, config, DB, parsers, core skills, env resolution — app layer)
  client/      — React + Vite frontend (pages, app-specific panels, wiring to @pi-tree/ui)
```

### Package boundaries

| Package | May import | Must NOT do |
|---------|-----------|-------------|
| `@pi-tree/core` | `@earendil-works/pi-coding-agent` | `process.env`, `import.meta.dirname`, file I/O |
| `@pi-tree/ui` | `@pi-tree/core/types`, React, lucide, marked, mermaid | App-specific API calls, env vars |
| `@pi-tree/server` | `@pi-tree/core`, node:fs | Client components |
| `@pi-tree/client` | `@pi-tree/ui`, `@pi-tree/core/types` | Direct Pi SDK imports |

**Key rule**: `@pi-tree/core` is a pure library. All environment resolution (API keys, model names, paths) happens in the server's app layer and is injected via `PiSessionConfig`.

### Types sub-path

`@pi-tree/core/types` exports only TypeScript types (TopicNode, Source, SessionState, ChatMessage, BranchOption, etc.) — safe for browser bundles. The main `@pi-tree/core` entry exports the Pi SDK wrapper and must only be imported server-side.

## Docs

- `docs/ARCHITECTURE.md` — How the server wraps Pi SDK, data ownership (Pi SDK owns JSONL sessions, pi-tree owns SQLite metadata), extension package design
- `docs/SESSION-MANAGEMENT.md` — Multi-session model, context binding, session lifecycle, API reference, future agent extensibility
- `docs/SELF-HOSTING.md` — All env vars, data layout, custom skills/extensions for self-hosters, Docker Compose examples
- `docs/VISION.md` — Design philosophy and product direction

## Key Concepts

- **Conversation-first**: The AI conversation IS the reading/research experience
- **Generic sources model**: Books, news feeds, papers, podcasts — all stored as `sources` with a `type` discriminator
- **Multi-session per source**: Each user+source can have multiple independent sessions (reading, Q&A, custom, news) — each with its own conversation tree and optional context configuration
- **Tree-structured sessions**: Each session has a topic tree; branches on semantic shifts only
- **Free-form depth**: Every node is a TopicNode — no rigid hierarchy
- **TOC + Chat navigation**: Clickable table of contents alongside conversational navigation
- **Configurable summaries**: Brief/medium/detailed, per-source overrides via config
- **Multi-user**: Each user has isolated sessions, config, glossary per source (no auth, slug-based identity)

## Core (`@pi-tree/core`)

Pure library — no `process.env`, no `import.meta.dirname`, no file system access.

- `PiSession`: wraps Pi SDK, manages conversation lifecycle
- `configureModelRegistry()`: extracted, testable model/provider setup (in `session/model-setup.ts`)
- `TreeManager`: intent classification → tree operations → PiSession
- Types: TopicNode, Source, SourceType, SessionState, ChatMessage, BranchOption, ContentAnchor, etc.

All config is injected via `PiSessionConfig` — the server resolves env vars and passes them in.

## Server Core Skills, Extensions & Agent Registry

The core skills, extensions, and ebook parsers live inside the `@pi-tree/server` package.

### Agent Directory (`packages/server/src/agents/`)

All agent capabilities live under `src/agents/` — a browsable directory of what the AI can do:

```
packages/server/src/agents/
  context.ts                 ← service locator for extension DI
  skills/                    ← markdown instruction bundles
    interactive-reading/     ← book reading flow
    book-outline/            ← structural overview
    book-analysis/           ← structured analysis
    news-reading/            ← news feed flow
    session-router/          ← routes users to sessions
  extensions/                ← tool bundles (TypeScript, runtime-loaded by Pi SDK)
    library/                 ← list_sources, get_source_info, create_session, open_session
    news/                    ← get_latest_rss, search_rss, aggregate_rss, etc.
```

Extensions are decoupled from server internals via `context.ts` — a service locator
that the server populates at startup. Extensions import `getExtensionServices()` from
`../../context.js` instead of reaching into `../../db/` or `../../services/`.

### Agent Registry (`src/services/agent-registry.ts`)

The agent registry discovers, validates, and resolves capabilities at startup:

1. **Discovery**: Scans `agents/skills/` + `agents/extensions/` for core capabilities, then `$DATA_PATH/skills/` + `$DATA_PATH/extensions/` for user overrides
2. **Validation**: Checks that all session profiles reference existing skills/extensions
3. **Resolution**: `resolveProfile(sourceType, mode, sessionContext)` → concrete paths for PiSession

### Session Profiles (`src/config/session-profiles.ts`)

Declarative mapping of `(sourceType, mode)` → skills, extensions, excludeTools, model:

- `book.reading` → `[interactive-reading]` skills, no extensions
- `book.analysis` → `[book-analysis, book-outline]` skills
- `news.news` → `[news-reading]` skill, `[news]` extension
- `router` → `[session-router]` skill, `[library]` extension

Resolution order: `${sourceType}.${mode}` → `${sourceType}` → `_default`. `SessionContext.skills` and `SessionContext.model` from the DB override the profile.

### Skill Override Mechanism

User skills live at `$DATA_PATH/skills/` (or `$SKILLS_PATH` if set). The loading order:

1. **Core skills discovered** from `packages/server/agents/skills/`
2. **User skills discovered** from `$DATA_PATH/skills/` — **user wins on name collision**

This means users can:
- **Override core skills** by creating a skill directory with the same name (e.g., `$DATA_PATH/skills/interactive-reading/`)
- **Add new skills** by creating new skill directories (e.g., `$DATA_PATH/skills/my-custom-skill/`)

## UI (`@pi-tree/ui`)

Reusable React components with `pit-` CSS class prefix. Components import their own CSS — no separate CSS imports needed by consumers.

### Components
- `ChatView` — Full chat interface (messages, input, branches, streaming)
- `Breadcrumb` — Navigation breadcrumb bar with panel toggles
- `MessageBubble` — Single message render (user/assistant/toolResult)
- `StreamingBubble` — Streaming AI response with cursor animation
- `InlineBranches` — Branch preview cards with expand/collapse
- `ToolCallIndicator` — Tool execution spinner

### Hooks
- `useMermaid` — Renders mermaid diagrams in markdown content
- `useScrollDirection` — Tracks scroll direction for shy-header UX

### CSS conventions

All classes use `pit-` prefix (e.g., `.pit-chat-view`, `.pit-breadcrumb-bar`). All design tokens use `--pit-*` custom properties (e.g., `--pit-accent`, `--pit-space-4`).

Theme file: `packages/ui/src/styles/pit-theme.css` bridges host app tokens to `pit-*` namespaced properties with sensible defaults. Consumers can:
1. Use defaults (works out of the box)
2. Override `--pit-*` properties for custom theming
3. (Future) Import only hooks for fully headless usage

### Prop-driven design

UI components are generic and prop-driven. App-specific concerns (API calls, user context, env vars) are injected via props:
- `ChatView` takes `renderSelectionToolbar` render prop, `fetchBranchPreview` callback, `modelName`, `userId`
- `Breadcrumb` takes `panelToggles` array, `sessionLabel`

## Server (`@pi-tree/server`)

App layer — owns environment resolution, config, database, and HTTP routes.

- Hono framework (lightweight, Electron-compatible)
- Resolves all env vars (`PI_MODEL`, `PI_API_KEY`, `DATA_PATH`, etc.) and injects into core via config
- LibraryService: reads from user-configured source library on disk + manages uploaded sources
- RssService: RSS feed crawling, deduplication, and aggregation for news sources
- SSE streaming for real-time AI responses
- SQLite + Drizzle ORM for user/session/config/glossary metadata

## Client (`@pi-tree/client`)

Thin app shell — wires `@pi-tree/ui` components with app-specific context.

- React + Vite (future: Electron desktop app)
- **Pages**: Library, Reader, SessionsPage, UserPicker
- **App panels**: Sidebar, RightPanel, DictionaryPanel, BookContentPanel, NewsDashboardPanel
- **News UX**: NewsQuickActions (skill command buttons), NewsDashboardPanel (interactive feed viewer with deep-dive)
- **Modals**: AddBookModal, BookSettingsModal, SettingsModal
- **Wiring**: Reader.tsx injects app dependencies into `@pi-tree/ui` via props
- **Context**: UserContext + UserPicker (localStorage-based identity)
- **Source type config**: `source-types.ts` exports `SOURCE_TYPE_CONFIGS` map — drives per-type UI behavior (icon, session modes, processing, content panel). Adding a new source type = one config entry.

## Database

SQLite via Drizzle ORM (`better-sqlite3`). DB file: `<DATA_PATH>/pi-tree.db` (default: `~/.local/share/pi-tree/`).

Tables:
- `users` — simple identity (slug id, displayName, avatarUrl)
- `sources` — universal "thing you have conversations about" with `type` discriminator ('book' | 'news' | 'paper' | 'podcast'), `metadata` JSON column for type-specific fields
- `user_sessions` — tracks Pi SDK JSONL session files per user+source. Supports multiple sessions per user+source with `title`, `context` (JSON blob of SessionContext), and `is_active` flag
- `user_source_config` — per-user per-source ReaderConfig JSON blob
- `user_source_progress` — reading position tracking
- `glossary_entries` — per-user per-source term definitions
- `source_tags` — source↔tag junction (replaces both book_tags and feed_tags)
- `rss_feeds` — RSS feed configurations, linked to sources via `source_id` FK
- `rss_items` — cached RSS feed entries

Tables auto-created on startup (CREATE TABLE IF NOT EXISTS). Schema: `packages/server/src/db/schema.ts`.

## Data Source

Books are stored in `<DATA_PATH>/library/` (default: `~/.local/share/pi-tree/library/`). Users can also upload books via the UI.

All mutable state (sessions, DB, library, news) lives under `DATA_PATH` (default: `~/.local/share/pi-tree/`).

## Data Isolation

| Data | Location | Scope |
|------|----------|-------|
| Session JSONL | `<DATA_PATH>/sessions/<sourceId>/<userId>/` | Per session per user per source |
| SQLite DB | `<DATA_PATH>/pi-tree.db` | All users |
| Session metadata | SQLite `user_sessions` | Per session per user per source |
| Config | SQLite `user_source_config` | Per user per source |
| Glossary | SQLite `glossary_entries` | Per user per source |
| Book content | `<DATA_PATH>/library/<sourceId>/markdown/` | Shared |
| Outlines | `<DATA_PATH>/library/<sourceId>/analysis/` | Shared |
| News reports | `<DATA_PATH>/news/analyses/`, `summaries/` | Shared (mutable) |
| User skills | `<DATA_PATH>/skills/` (or `$SKILLS_PATH`) | Shared (mutable) |
| Default feeds | `packages/server/config/default-feeds.json` | Repo (read-only) |

## Session Management

Multiple sessions per user+source. Each session has a `SessionContext` (mode, optional skills/prompt/model overrides) stored as JSON. See `docs/SESSION-MANAGEMENT.md` for full architecture.

**Session API** (CRUD):
- `GET /api/sessions/:userId/:sourceId` — list all sessions
- `POST /api/sessions/:userId/:sourceId` — create `{ title, context? }`
- `PUT /api/sessions/:userId/:sourceId/:sessionId` — update `{ title?, context? }`
- `DELETE /api/sessions/:userId/:sourceId/:sessionId` — soft-delete

**Session interaction routes** (`/api/session/*`) all accept optional `sessionId` in request body. When omitted, defaults to most recently active session.

**URLs**:
- Sessions management: `/source/:sourceId/sessions`
- Reading session: `/source/:sourceId?session=<id>&node=<nodeId>`

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

## Testing

Tests run with `vitest`. No env vars required — test files use `vi.stubEnv` to mock paths with temp dirs.

```bash
npm test                    # all unit tests (core + server)
npx vitest run              # same, explicit
npx vitest run --exclude="e2e/**" --exclude="**/dist/**"  # skip Playwright + dist
```

- `packages/core/src/session/__tests__/model-setup.test.ts` — model registry setup (15 tests)
- `packages/server/src/__tests__/api-smoke.test.ts` — in-process API routes (27 tests, no HTTP server)
- `e2e/smoke.spec.ts` — Playwright end-to-end (needs running server + browser)

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

Docker reads `.env` directly via `env_file` and uses `PORT=3847` as-is. The `docker-compose.yml` overrides `DATA_PATH` for the container filesystem.

Volumes:
- `pi-tree-data` named volume → `/data` (all state: library, sessions, SQLite DB)

Env vars: `DATA_PATH`, `PORT`, `PI_MODEL`.
