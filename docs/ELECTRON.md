# Electron App

Pi-tree's architecture already maps cleanly to Electron. The core is a pure library, the UI is standard React, and Hono's `app.fetch()` accepts a `Request` and returns a `Response` without needing an HTTP server. This document captures what works, what needs to change, and the migration plan.

## Architecture Mapping

```
┌─────────────────────────────────────────────────┐
│  Electron Main Process                          │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  bootstrap()                              │  │
│  │  - RSS service init                       │  │
│  │  - MCP bridge connect                     │  │
│  │  - Agent registry setup                   │  │
│  │  - Extension DI (setExtensionServices)    │  │
│  └───────────────────────────────────────────┘  │
│                    │                             │
│                    ▼                             │
│  ┌───────────────────────────────────────────┐  │
│  │  Hono app (routes, middleware)            │  │
│  │  app.fetch(request) → response            │  │
│  └───────────────────────────────────────────┘  │
│                    │                             │
│          IPC bridge (or local HTTP)              │
│                    │                             │
├────────────────────┼────────────────────────────┤
│  Electron Renderer │                             │
│                    ▼                             │
│  ┌───────────────────────────────────────────┐  │
│  │  React app (@pi-tree/client + @pi-tree/ui)│  │
│  │  fetch(url) → IPC → app.fetch() → IPC    │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Main process**: Runs `bootstrap()` to init services, then exposes `app.fetch()` via IPC or a local HTTP server.

**Renderer process**: Same React app as the web version. The only difference is how `fetch()` reaches the server — IPC instead of HTTP.

## What Already Works

| Area | Why |
|------|-----|
| `@pi-tree/core` | Pure library — no Node APIs, no env vars, no file I/O |
| `@pi-tree/ui` | Standard React components, works in Chromium renderer |
| API URL config | `import.meta.env.VITE_API_URL \|\| ''` — configurable per environment |
| Hono `app.fetch()` | Standard `Request → Response` — works without HTTP server |
| `DATA_PATH` | Env-var driven — set `process.env.DATA_PATH = app.getPath('userData')` before import |
| Native deps | Only `better-sqlite3` needs `@electron/rebuild` (well-supported) |

## What Needs to Change

### 1. Extract `bootstrap()` from server entry point

**Problem**: `index.ts` couples service initialization with `serve()` and RSS cron scheduling. Importing `@pi-tree/server` triggers all of it.

**Current**:
```
index.ts  →  init RSS + MCP + agents + cron + serve()
app.ts    →  Hono routes (clean, no side effects)
```

**Target**:
```
app.ts        →  Hono routes (unchanged)
bootstrap.ts  →  async bootstrap(config) → { app, services, cleanup }
index.ts      →  CLI entry: bootstrap() + serve() + cron
```

The `bootstrap()` function:

```typescript
export interface BootstrapConfig {
  dataPath: string;              // Electron: app.getPath('userData')
  coreAgentsDir?: string;        // default: resolve from package
  userSkillsDir?: string;        // default: dataPath/skills
  userExtensionsDir?: string;    // default: dataPath/extensions
}

export interface BootstrapResult {
  app: Hono;
  rssService: RssService;
  mcpBridge: McpBridge;
  cleanup: () => Promise<void>;  // disconnect MCP, clear intervals
}

export async function bootstrap(config: BootstrapConfig): Promise<BootstrapResult>;
```

Electron's main process calls:
```typescript
const { app } = await bootstrap({
  dataPath: electronApp.getPath('userData'),
});
```

### 2. Make resource paths injectable

**Problem**: Seven places in the server use `import.meta.dirname` to resolve paths relative to the source file. Inside Electron's ASAR archive, these paths resolve into the archive and may not be readable.

**Affected files**:

| File | Usage |
|------|-------|
| `index.ts` | `join(import.meta.dirname, "agents")` — core agents dir |
| `load-env.ts` | `resolve(import.meta.dirname, "../../..")` — repo root for .env |
| `book-ingestion.ts` | `join(import.meta.dirname, "../../../..")` — repo root |
| `dictionary.service.ts` | `join(import.meta.dirname, "../../../..")` — repo root |
| `tree-manager.ts` | `join(import.meta.dirname, "../../../..")` — repo root |
| `rss.service.ts` | `join(import.meta.dirname, "../../config/default-feeds.json")` — default feeds |

**Fix**: Pass these paths through `BootstrapConfig` or the extension services context. Services receive resolved paths instead of computing them from `import.meta.dirname`. The current `import.meta.dirname` logic becomes the default fallback for non-Electron (CLI/Docker) usage.

### 3. Add `./app` package export

Add to `packages/server/package.json`:
```json
"./app": {
  "source": "./src/app.ts",
  "types": "./dist/app.d.ts",
  "import": "./dist/app.js"
},
"./bootstrap": {
  "source": "./src/bootstrap.ts",
  "types": "./dist/bootstrap.d.ts",
  "import": "./dist/bootstrap.js"
}
```

This lets Electron import exactly what it needs without pulling in the CLI entry point.

## Client ↔ Server Communication

Two viable approaches, in order of implementation effort:

### Option A: Local HTTP (recommended for v1)

Electron main process starts Hono on a random port:
```typescript
const { app } = await bootstrap({ dataPath });
const server = serve({ fetch: app.fetch, port: 0 });
// Send port to renderer via IPC
mainWindow.webContents.send('server-port', server.port);
```

Renderer sets `VITE_API_URL` to `http://localhost:<port>`. **Zero client code changes.**

### Option B: IPC Bridge (optimal, future)

A custom fetch adapter in the renderer routes requests through `ipcRenderer.invoke()`:
```typescript
// preload.ts
contextBridge.exposeInMainWorld('electronFetch', async (url, init) => {
  return ipcRenderer.invoke('fetch', url, init);
});

// main process
ipcMain.handle('fetch', async (_, url, init) => {
  const req = new Request(url, init);
  const res = await app.fetch(req);
  return { status: res.status, body: await res.text(), headers: Object.fromEntries(res.headers) };
});
```

No HTTP server needed. ~50 lines of bridge code. Can be added later without changing the server or client.

## Native Dependencies

Only one: `better-sqlite3`. Handled by `@electron/rebuild` in the build pipeline. No other native modules.

Alternative: `sql.js` (WASM-based SQLite) eliminates the native rebuild requirement entirely, at the cost of slightly slower query performance. Not necessary unless rebuild becomes a CI pain point.

## Packaging Notes

- **ASAR**: The `agents/skills/` and `config/` directories contain files read at runtime (`.md` skills, `.json` feeds). These need to be either:
  - Extracted via `asarUnpack` in electron-builder config
  - Or resolved through injectable paths (preferred — see #2 above)
- **Build output**: `packages/server/dist/` → bundled into main process, `packages/client/dist/` → loaded in renderer
- **Data directory**: `app.getPath('userData')` → `~/Library/Application Support/pi-tree` (macOS), `~/.config/pi-tree` (Linux), `%APPDATA%/pi-tree` (Windows)
