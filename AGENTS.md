# Pi-Tree

AI-assisted reading and research app with tree-structured conversations. Supports multiple source types: books, news feeds, papers, and more.

## Architecture

Monorepo with multiple packages:

```
packages/
  core/           — Pure library: PiSession, TreeManager, model-setup, types (no env vars, no fs)
  shared/         — Shared types (Source, SessionContext, ReaderConfig, ServerConfig, etc.)
  plugin-sdk/     — Plugin authoring SDK: definePiTreeExtension(), typed services, route/manifest types
  plugin-book/    — skills, tools (process_book), parsers (epub, mobi, pdf)
  plugin-news/    — RSS tools, own SQLite DB, routes, crawling service, skills
  plugin-paper/   — search_papers, get_paper_info, read_paper, skills
  plugin-youtube/ — get_youtube_info, transcript, skills, embedded video player
  plugin-mcp/     — MCP client bridge — registers tools from external MCP servers
  ui/             — React component library: ChatView, Breadcrumb, InlineBranches (pit-* namespaced)
  server/         — Hono API server (routes, config, DB, env resolution — app layer)
  client/         — React + Vite frontend (pages, app-specific panels, wiring to @pi-tree/ui)
  electron/       — Electron desktop app shell
  mcp/            — MCP server exposing pi-tree tools
```

Each plugin package (`packages/plugin-*`) is an independent workspace with its own `package.json` and dependencies.

### Package boundaries

| Package | May import | Must NOT do |
|---------|-----------|-------------|
| `@pi-tree/core` | `@earendil-works/pi-coding-agent` | `process.env`, `import.meta.dirname`, file I/O |
| `@pi-tree/plugin-sdk` | `@earendil-works/pi-coding-agent` (types only) | Server internals, DB, env vars |
| `@pi-tree/shared` | (none — standalone types) | Server internals, DB, env vars |
| `pi-tree-*` plugins | `@pi-tree/plugin-sdk`, typebox | Server internals, direct DB, env vars |
| `@pi-tree/ui` | `@pi-tree/core/types`, React, lucide, marked, mermaid | App-specific API calls, env vars |
| `@pi-tree/server` | `@pi-tree/core`, `pi-tree-*` plugins, `@pi-tree/plugin-sdk`, node:fs | Client components |
| `@pi-tree/client` | `@pi-tree/ui`, `@pi-tree/core/types` | Direct Pi SDK imports |

**Key rule**: `@pi-tree/core` is a pure library. All environment resolution (API keys, model names, paths) happens in the server's app layer and is injected via `PiSessionConfig`.

### Types sub-path

`@pi-tree/core/types` exports only TypeScript types (TopicNode, Source, SessionState, ChatMessage, BranchOption, etc.) — safe for browser bundles. The main `@pi-tree/core` entry exports the Pi SDK wrapper and must only be imported server-side.

## Docs

User-facing documentation lives in `docs/` (published to GitHub Pages via VitePress):

- `docs/docs/architecture.md` — How the server wraps Pi SDK, data ownership, agent directory, session profiles
- `docs/docs/sessions.md` — Multi-session model, context binding, session lifecycle, API reference
- `docs/docs/self-hosting.md` — All env vars, data layout, custom skills/extensions for self-hosters, Docker Compose examples
- `docs/vision.md` — Design philosophy and product direction

Internal design docs (not published, gitignored in `local-docs/`):

- `local-docs/ELECTRON.md` — Electron app design: architecture mapping, bootstrap extraction, IPC vs HTTP, packaging
- `local-docs/GLOBAL-CHAT.md` — Cross-source conversation / global chat design: memory tiers, tool design, data model

## Key Concepts

- **Conversation-first**: The AI conversation IS the reading/research experience
- **Generic sources model**: Books, news feeds, papers — all stored as `sources` with a `type` discriminator
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
- Types: TopicNode, Source, SourceType (`string` with well-known values `'book'`, `'news'`, `'paper'`), SessionState, ChatMessage, BranchOption, ContentAnchor, etc.

All config is injected via `PiSessionConfig` — the server resolves env vars and passes them in.

## Plugin SDK (`@pi-tree/plugin-sdk`)

SDK package for building pi-tree plugins. Standalone — no server internals, importable by user plugins.

### Exports

- `definePiTreeExtension(factory)` — wraps a Pi SDK extension to inject typed `PiTreeServices`. Gracefully no-ops when loaded outside pi-tree (e.g., in pi CLI).
- `getPiTreeServices()` — returns `PiTreeServices | null` for hybrid extensions that optionally enhance inside pi-tree.
- Type exports: `PiTreeServices`, `SourceService`, `SessionService`, `UserService`, `RegistryService`, `ExtensionConfig`, `ProfileInfo`, `PluginRouteContext`, `PluginSetupResult`, `PluginManifest`.

### Usage

```typescript
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";

export default definePiTreeExtension((pi, services) => {
  pi.registerTool({ /* use services.sources, services.sessions, etc. */ });
});
```

### Service interfaces

| Service | Methods |
|---------|---------|
| `sources` | `list(filter?)`, `get(id)` |
| `sessions` | `listForSource(userId, sourceId)`, `create(userId, sourceId, opts)`, `resolveUserId(sessionFile)`, `getById(id)` |
| `users` | `get(id)`, `ensureExists(id)` |
| `registry` | `getProfiles()` |
| `config` | `jinaApiKey?` |

Also available: `getPluginDataDir(name)`, `mcpBridge`, `dataPath`, `db()` (raw Drizzle), `schema`.

### Plugin routes

Plugins can declare HTTP routes via their `package.json`:

```json
{
  "piTree": {
    "routes": "./routes.ts",
    "routePrefix": "/api/news"
  }
}
```

The routes module exports a `setup(ctx: PluginRouteContext): PluginSetupResult` function. The server mounts the returned Hono sub-app at the declared prefix and calls `cleanup()` on shutdown.

## Server Core Skills, Extensions & Agent Registry

The core skills, extensions, and ebook parsers are split across packages.

### Agent Directory

Agent capabilities are organized across two locations:

```
packages/plugin-book/              ← skills (interactive-reading, book-outline, book-analysis)
                                     tools (process_book), parsers (epub, mobi, pdf)
packages/plugin-news/              ← tools (get_latest_rss, search_rss, etc.), own SQLite DB,
                                     routes (/api/news/*), RSS crawling service, skills (news-reading)
packages/plugin-mcp/               ← MCP client bridge — dynamically registers tools from external MCP servers
packages/plugin-paper/             ← search_papers, get_paper_info, read_paper, skills (paper-reading)
packages/plugin-youtube/           ← get_youtube_info, get_youtube_transcript, skills (youtube-watching),
                                     embedded video player content panel

packages/server/src/agents/       ← server-bundled capabilities
  context.ts                       ← service locator for plugin DI
  extensions/router/               ← list_sources, create_session, open_session, create_youtube_source (core navigation)
  skills/session-router/           ← session routing flow
```

Plugins depend only on `@pi-tree/plugin-sdk` and use `definePiTreeExtension()` —
they have no imports from server internals. Services are injected at runtime via `globalThis.__piTreeServices`.

Plugins declare `badges` in `piTree.sourceType` manifest — each badge checks a source field for truthiness or equality and renders on the library card.

### MCP Client Bridge (`src/services/mcp-bridge.ts`)

The server can connect to external MCP servers and expose their tools to the AI agent. This enables web search, academic databases, translation APIs, and any other MCP-compatible tool without adding code to the repo.

**Config**: `$DATA_PATH/mcp.json` (same format as Claude Desktop / Cursor):
```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-brave-search"],
      "env": { "BRAVE_API_KEY": "..." }
    }
  }
}
```

**How it works**: At server startup, `McpBridge` connects to configured MCP servers, discovers their tools via `tools/list`, and the `mcp` extension registers each discovered tool as a Pi SDK tool (prefixed `mcp_{server}_{tool}`). The `mcp` extension is included in all session profiles but no-ops silently when no MCP servers are configured.

### Agent Registry (`src/services/agent-registry.ts`)

The agent registry discovers, validates, and resolves capabilities at startup:

1. **Discovery**: Scans individual plugin packages (`packages/plugin-*`) for core extensions + `agents/skills/` for core skills, then `$DATA_PATH/extensions/` + `$DATA_PATH/skills/` for user overrides. User-defined profiles from `$DATA_PATH/profiles/*.yml` are also discovered and merged (user wins on name collision).
2. **Validation**: Checks that all session profiles reference existing skills/extensions
3. **Resolution**: `resolveProfile(sourceType, mode, sessionContext)` → concrete paths for PiSession

### Session Profiles

Declarative YAML files mapping `(sourceType, mode)` → skills, extensions, excludeTools, model. Profiles are bundled inside plugins (`packages/plugin-*/profiles/*.yml`) and the server (`packages/server/src/profiles/*.yml`).

Examples:
- `book.reading` → `[interactive-reading]` skills
- `book.analysis` → `[book-analysis, book-outline]` skills
- `news.news` → `[news-reading]` skill, `[news]` extension
- `router` → `[session-router]` skill, `extensions: ["*"]` (wildcard — auto-includes all registered extensions)

Resolution order: `${sourceType}.${mode}` → `${sourceType}` → `_default`. `SessionContext.skills` and `SessionContext.model` from the DB override the profile.

The wildcard `"*"` in `extensions` expands to all registered extension names at resolution time. This means the router's home chat automatically gains new plugin tools when a new plugin is installed.

Custom profiles (`$DATA_PATH/profiles/*.yml`) support an optional `source_type` field (e.g. `book`, `news`). When set, the profile appears as an additional session mode in the SessionPicker only for sources of that type.

### Skill Override Mechanism

Skills are discovered from multiple locations. The loading order:

1. **Plugin-bundled skills** from `packages/plugin-*/skills/` (and `packages/server/src/agents/skills/`)
2. **User skills** from `$DATA_PATH/skills/` (or `$SKILLS_PATH`) — **user wins on name collision**

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
- DictionaryService: AI-powered term lookup + glossary management
- SSE streaming for real-time AI responses
- SQLite + Drizzle ORM for user/session/config/glossary metadata
- Mounts plugin-declared routes at startup via AgentRegistry discovery
- Router extension: core navigation tools (list_sources, create_session, etc.)

## Client (`@pi-tree/client`)

Thin app shell — wires `@pi-tree/ui` components with app-specific context.

- React + Vite (future: Electron desktop app)
- **Pages**: Library, Reader, SessionsPage, UserPicker
- **App panels**: Sidebar, RightPanel, DictionaryPanel
- **Modals**: AddSourceModal, SourceSettingsModal, SettingsModal
- **Wiring**: Reader.tsx injects app dependencies into `@pi-tree/ui` via props
- **Context**: UserContext + UserPicker (localStorage-based identity)
- **Source type config**: `source-types.ts` exports `SOURCE_TYPE_CONFIGS` map — drives per-type UI behavior (icon, session modes, processing, content panel). Adding a new source type = one config entry.

## Database

SQLite via Drizzle ORM (`better-sqlite3`). DB file: `<DATA_PATH>/pi-tree.db` (default: `~/.local/share/pi-tree/`).

Tables:
- `users` — simple identity (slug id, displayName, avatarUrl)
- `sources` — universal "thing you have conversations about" with `type` discriminator (`string`, well-known: `'book'`, `'news'`, `'paper'`), `metadata` JSON column for type-specific fields
- `user_sessions` — tracks Pi SDK JSONL session files per user+source. Supports multiple sessions per user+source with `title`, `context` (JSON blob of SessionContext), and `is_active` flag
- `user_source_config` — per-user per-source ReaderConfig JSON blob
- `user_source_progress` — reading position tracking
- `glossary_entries` — per-user per-source term definitions
- `source_tags` — source↔tag junction (replaces both book_tags and feed_tags)

Tables auto-created on startup (CREATE TABLE IF NOT EXISTS). Schema: `packages/server/src/db/schema.ts`.

Plugins may own their own SQLite databases at `$DATA_PATH/plugins/<name>/`. For example, the news plugin stores `rss_feeds` and `rss_items` in `$DATA_PATH/plugins/news/news.db`.

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
| Source content | `<DATA_PATH>/sources/<sourceId>/markdown/` | Shared (primary write target) |
| Source outlines | `<DATA_PATH>/sources/<sourceId>/analysis/` | Shared |
| News reports | `<DATA_PATH>/sources/news/analyses/`, `summaries/` | Shared (mutable) |
| News routing context | `<DATA_PATH>/sources/news/feeds.json` | Shared (mutable) |
| Plugin data | `<DATA_PATH>/plugins/<name>/` | Per plugin (infrastructure: DBs, caches) |
| User skills | `<DATA_PATH>/skills/` (or `$SKILLS_PATH`) | Shared (mutable) |
| User extensions | `<DATA_PATH>/extensions/` (or `$EXTENSIONS_PATH`) | Shared (mutable) |
| User profiles | `<DATA_PATH>/profiles/` | Shared (mutable) |
| Default feeds | `packages/plugin-news/config/default-feeds.yml` | Repo (read-only) |

## Session Management

Multiple sessions per user+source. Each session has a `SessionContext` (mode, optional skills/prompt/model overrides) stored as JSON. See `docs/docs/sessions.md` for full architecture.

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

The dev server imports `@pi-tree/core` source directly via `--conditions=source` (no build needed) and watches `packages/core/src/` for changes via `--include`. Editing any core file auto-restarts the server. **Do not run `npm run build` in core during development.**

## Docker

```bash
docker compose up --build
```

The container has `restart: unless-stopped` so it auto-starts with Docker.

Docker reads `.env` directly via `env_file` and uses `PORT=3847` as-is. The `docker-compose.yml` overrides `DATA_PATH` for the container filesystem.

Volumes:
- `pi-tree-data` named volume → `/data` (all state: library, sessions, SQLite DB)

Env vars: `DATA_PATH`, `PORT`, `PI_MODEL`.

## Releasing

All packages in the monorepo share a single version. **Never edit version numbers in individual `package.json` files** — use the bump script:

```bash
./scripts/bump-version.sh 0.3.0    # updates all package.json + README badge + commit + tag
git push && git push --tags
```

The script:
1. Updates `version` in root `package.json` and all workspace `package.json` files
2. Updates the static release badge in `README.md`
3. Creates a commit: `chore: bump version to v0.3.0`
4. Creates an annotated git tag: `v0.3.0`

**Important**: The Electron build (`packages/electron/electron-builder.yml`) reads `${version}` from `packages/electron/package.json` for artifact naming. If versions drift, release artifacts will have wrong version numbers.

## Theme & Input Styling Pattern

When adding forms, modals, or user input fields, avoid hardcoding dark or light mode background and text colors (e.g., `#1a1a1e`, `#eee`). Instead, follow the host application's design tokens to support all reading themes (sepia, dark-ink, light, etc.):

- **Shared Classes**: Wherever possible, reuse `.add-source-form` and `.add-source-field` from the parent modal for input containers.
- **Theme Variables**: If custom components/styles are required, always bind to standard CSS variables:
  - Input Background: `var(--bg-primary, #fff)`
  - Text Color: `var(--text-primary, #333)`
  - Secondary Text: `var(--text-secondary, #666)`
  - Borders: `var(--border-primary, #ddd)` or `var(--border)`
  - Accents/Focus: `var(--accent, #6c5ce7)`

## Dynamic System Context for Source Types

Plugins can define a custom welcome/system context prompt template inside their `package.json` manifest under `piTree.sourceType`. This prompt is injected as the initial instructions for the AI session.

### Configuration

Add the `systemContext` property (an array of strings) under `piTree.sourceType` inside the plugin's `package.json`:

```json
{
  "piTree": {
    "sourceType": {
      "key": "my-source-type",
      "label": "My Plugin Source",
      "systemContext": [
        "[SYSTEM CONTEXT — My Session]",
        "You are now in a dedicated session for my custom source.",
        "Source ID: {sourceId}",
        "User ID: {userId}",
        "",
        "IMPORTANT: Focus only on custom tools and do not read filesystem books."
      ]
    }
  }
}
```

### Placeholders

The following placeholders are supported and will be automatically interpolated at runtime before launching the session:
- `{sourceId}`: The unique ID of the loaded source.
- `{userId}`: The slug of the active user.

## Mention Routing

The home page router supports `@mention` syntax for navigating to sources. Mentions are parsed by `packages/server/src/agents/extensions/router/mention-parser.ts` and support three components:

```
@Keyword:Qualifier#tag
```

- **`@Keyword`** — matches a plugin's `mentionKeyword` (e.g. `@News`, `@Paper`) or a source title (`@Dune`)
- **`:Qualifier`** — optional qualifier (e.g. a feed name, channel, collection)
- **`#tag`** — optional tag filter

### Deterministic routing

The server exposes `POST /api/router/route` which resolves mentions without any LLM call. For unambiguous `@mention` requests, the client calls this endpoint first and navigates directly — reducing routing latency from seconds to ~100ms. Ambiguous cases (no mention, YouTube URLs, time-based "ask" zone) fall back to the LLM router.

### Plugin manifest fields for routing

Plugins declare routing behavior in `piTree.sourceType` inside `package.json`:

```json
{
  "piTree": {
    "sourceType": {
      "mentionKeyword": "News",
      "fixedSourceId": "news",
      "sessionStrategy": "time-based",
      "askAfterHours": 4,
      "staleAfterHours": 12,
      "tagPromptTemplate": "Focus on feeds tagged '{tags}'",
      "qualifierPromptTemplate": "Focus on the {qualifier} feed"
    }
  }
}
```

| Field | Purpose | Default |
|-------|---------|---------|
| `mentionKeyword` | Keyword matched in `@mentions` (e.g. "News"). If omitted, source titles are fuzzy-matched. | — |
| `fixedSourceId` | Singleton source ID (e.g. "news"). If omitted, resolved via title search. | — |
| `sessionStrategy` | `"reuse-same-mode"` or `"time-based"` | `"reuse-same-mode"` |
| `askAfterHours` | Time-based: hours before asking user to resume or create new | `4` |
| `staleAfterHours` | Time-based: hours after which a session is considered stale | `12` |
| `tagPromptTemplate` | Prompt template for `#tag` mentions. `{tags}` is replaced with the tag list. | `"Focus on tag '{tags}'"` |
| `qualifierPromptTemplate` | Prompt template for `:qualifier` mentions. `{qualifier}` is replaced with the value. | `"Focus on {qualifier}"` |
