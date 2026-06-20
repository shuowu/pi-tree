---
title: Plugin Guide
description: How to build and customize pi-tree plugins — from simple skill overrides to full source type plugins.
---

# Plugin Guide

Pi-tree is built on the [Pi SDK](https://pi.dev/docs/latest/sdk) — a minimalist AI agent framework. Pi-tree plugins extend Pi SDK's primitives with source-type-specific behavior:

| Pi SDK concept | What it does | Pi SDK docs | Pi-tree adds |
|---|---|---|---|
| **Extension** | TypeScript module that registers AI tools | [Extensions](https://pi.dev/docs/latest/extensions) | `definePiTreeExtension()` for access to pi-tree services |
| **Skill** | Markdown file with AI behavior instructions | [Skills](https://pi.dev/docs/latest/skills) | Source-type-scoped skills bundled in plugins |
| **Tool** | Function the AI can call during a session | [Extensions → Tools](https://pi.dev/docs/latest/extensions) | Same API, registered via extensions |

Pi-tree adds three concepts on top:

- **Session profiles** — YAML files that wire skills + extensions together for a `(sourceType, mode)` pair
- **Source type manifest** — `piTree` field in `package.json` that declares UI config, routes, and content panels
- **Plugin SDK services** — typed access to pi-tree's sources, sessions, users, and registry from within extensions

## Three Levels of Customization

| Level | What you create | Restart needed? | Use case |
|---|---|---|---|
| **Custom skills** | A `SKILL.md` file | No | Change AI behavior for existing source types |
| **Custom profiles** | A `.yml` file | Yes | New session modes for existing source types |
| **Full plugin** | A package with `package.json` | Yes | New source type with tools, skills, routes, UI |

## Custom Skills (No Code)

Skills are Pi SDK's [skill files](https://pi.dev/docs/latest/skills) — markdown instructions that shape how the AI behaves. Drop one into `$DATA_PATH/skills/` and it takes effect on the next session — no restart, no build step.

### Create a new skill

Create `$DATA_PATH/skills/my-skill/SKILL.md`:

```markdown
---
name: my-skill
description: One-line summary of what this skill does
---

# My Custom Skill

You are a specialized reading assistant. When the user asks you to...

## Guidelines

- Always cite specific sections or page numbers
- Use structured formatting with headers and bullet points
- Ask clarifying questions before diving deep
```

### Override a built-in skill

To change how book reading works, create a skill with the same name as the built-in one:

```bash
# Override the interactive-reading skill
mkdir -p "$DATA_PATH/skills/interactive-reading"
cp packages/plugin-book/skills/interactive-reading/SKILL.md \
   "$DATA_PATH/skills/interactive-reading/SKILL.md"

# Edit to taste
```

User skills win on name collision — the original is completely replaced.

## Custom Session Profiles

Profiles are a pi-tree concept (not from Pi SDK). They wire skills and extensions together for a specific `(sourceType, mode)` pair. They're YAML files in `$DATA_PATH/profiles/`.

### Create a new session mode

Create `$DATA_PATH/profiles/book.analysis.yml`:

```yaml
name: book.analysis
label: Deep Analysis
description: Detailed analytical reading with structured note-taking
source_type: book

skills:
  - book-analysis
  - book-outline

extensions:
  - book

exclude_tools: [bash, edit]
```

This adds a "Deep Analysis" mode to the session picker for all book sources.

### Profile fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique key, typically `sourceType.mode` |
| `label` | Yes | Shown in session picker UI |
| `description` | No | One-line description |
| `source_type` | No | Limits this mode to sources of this type |
| `skills` | Yes | List of skill names to load |
| `extensions` | No | List of extension names (use `["*"]` for all) |
| `exclude_tools` | No | Tools to block (default: `[bash, edit]`) |
| `model` | No | Override the default model for this mode |

## Full Plugin

A full plugin is a Pi SDK package ([Pi Packages](https://pi.dev/docs/latest/extensions)) enhanced with a pi-tree manifest. It provides a new source type with its own tools, skills, profiles, routes, and UI components.

### Plugin structure

```
packages/plugin-example/
├── package.json          # Pi package config + piTree manifest
├── index.ts              # Pi extension: registers AI tools
├── skills/
│   └── example-reading/
│       └── SKILL.md      # Pi skill: AI behavior instructions
├── profiles/
│   └── example.reading.yml  # Pi-tree profile: wires skills + extensions
├── routes.ts             # Pi-tree: HTTP API routes (optional)
└── ui/
    └── ContentPanel.tsx  # Pi-tree: right-panel UI component (optional)
```

### The manifest (`package.json`)

A plugin's `package.json` has two sections:
- **`pi`** — standard Pi SDK config (extensions and skills paths)
- **`piTree`** — pi-tree-specific config (source type, routes, UI)

```json
{
  "name": "pi-tree-example",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "piTree": {
    "sourceType": {
      "key": "example",
      "label": "Example",
      "icon": "puzzle",
      "sessionModes": ["reading", "custom"],
      "defaultMode": "reading",
      "autoStartMode": "reading",
      "hasProcessing": false,
      "searchPlaceholder": "Search examples...",
      "chatPlaceholder": "Ask about this example…",
      "addSource": {
        "subtitle": "Add an example source",
        "fields": [
          { "key": "title", "label": "Title", "required": true },
          { "key": "url", "label": "URL", "placeholder": "https://..." }
        ]
      },
      "cardSubtitle": "{author}"
    },
    "routes": "./routes.ts",
    "routePrefix": "/api/example",
    "ui": {
      "contentPanel": "./ui/ContentPanel.tsx"
    }
  },
  "pi": {
    "extensions": ["./index.ts"],
    "skills": ["./skills"]
  },
  "dependencies": {
    "@pi-tree/plugin-sdk": "*",
    "typebox": "^1.2.6"
  }
}
```

### Pi SDK fields (`pi`)

These follow Pi SDK conventions — see [Pi Packages](https://pi.dev/docs/latest/extensions) for details:

| Field | Description |
|---|---|
| `pi.extensions` | Paths to [extension modules](https://pi.dev/docs/latest/extensions) that register tools |
| `pi.skills` | Paths to [skill directories](https://pi.dev/docs/latest/skills) |

### Pi-tree fields (`piTree`)

These are pi-tree additions — they tell the server how to wire the plugin into the app:

| Field | Description |
|---|---|
| `piTree.sourceType.key` | Unique source type identifier (e.g. `"podcast"`) |
| `piTree.sourceType.label` | Human-readable name shown in UI |
| `piTree.sourceType.icon` | [Lucide icon](https://lucide.dev) name |
| `piTree.sourceType.sessionModes` | Available session modes |
| `piTree.sourceType.addSource` | Config for the "Add Source" modal form |
| `piTree.sourceType.systemContext` | Template for AI system prompt (supports `{sourceId}`, `{userId}` placeholders) |
| `piTree.routes` | Path to HTTP routes module |
| `piTree.routePrefix` | URL prefix for plugin routes |
| `piTree.ui.contentPanel` | Path to right-panel React component |

### Extension with pi-tree services

A standard Pi extension registers tools via `pi.registerTool()` ([docs](https://pi.dev/docs/latest/extensions)). Pi-tree's `definePiTreeExtension()` wraps this to inject typed services:

```typescript
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";
import { Type } from "typebox";

export default definePiTreeExtension((pi, services) => {
  // pi — standard Pi SDK ExtensionAPI
  // services — pi-tree services (sources, sessions, users, etc.)

  pi.registerTool({
    name: "create_example_source",
    label: "Create Example Source",
    description: "Create a new source in the library.",
    parameters: Type.Object({
      title: Type.String({ description: "Source title" }),
    }),
    async execute(_toolCallId, params) {
      const source = services.sources.create({
        id: slugify(params.title),
        type: "example",
        title: params.title,
        source: "system",
        status: "ready",
      });

      return {
        content: [{ type: "text", text: `Created: ${source.title}` }],
        details: undefined,
      };
    },
  });
});
```

If your extension doesn't need pi-tree services, use a plain Pi extension:

```typescript
// Standard Pi SDK extension — no pi-tree dependency
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({ /* ... */ });
}
```

### Available pi-tree services

These are injected by `definePiTreeExtension()` — they're the pi-tree layer on top of Pi SDK:

| Service | Methods | Use case |
|---|---|---|
| `services.sources` | `list()`, `get(id)`, `create()`, `update()` | Manage sources in the library |
| `services.sessions` | `listForSource()`, `create()`, `getById()` | Manage user sessions |
| `services.users` | `get(id)`, `ensureExists(id)` | User identity |
| `services.registry` | `getProfiles()`, `getSourceTypes()` | Profile introspection |
| `services.getPluginDataDir(name)` | — | Scoped data directory for your plugin |
| `services.dataPath` | — | Root data directory |

### HTTP routes (optional)

Plugins can declare HTTP routes — this is a pi-tree feature (not from Pi SDK):

```typescript
// routes.ts
import { Hono } from "hono";
import type { PluginRouteContext, PluginSetupResult } from "@pi-tree/plugin-sdk";

export function setup(ctx: PluginRouteContext): PluginSetupResult {
  const app = new Hono();

  app.get("/items", (c) => {
    // ctx.dataDir — your plugin's data directory
    // ctx.sources — source service for CRUD
    return c.json({ items: [] });
  });

  return {
    routes: app,
    cleanup: () => {
      // Called on server shutdown — close DBs, stop timers, etc.
    },
  };
}
```

The server mounts these at the declared `routePrefix` (e.g. `/api/example/items`).

### Right-panel UI (optional)

Plugins can provide a React component for the right sidebar — another pi-tree addition:

```tsx
// ui/ContentPanel.tsx
import type { ContentPanelProps } from "@pi-tree/ui";

export default function ContentPanel({ sourceId, onSendMessage }: ContentPanelProps) {
  return (
    <div className="my-plugin-panel">
      <h3>Example Panel</h3>
      <p>Source: {sourceId}</p>
      <button onClick={() => onSendMessage?.("Summarize this")}>
        Quick Summary
      </button>
    </div>
  );
}
```

The panel appears as a tab in the right sidebar alongside Dictionary.

## Existing Plugins

For real-world examples, see the built-in plugins (ordered by complexity):

| Plugin | Complexity | Pi SDK parts | Pi-tree additions |
|---|---|---|---|
| [`plugin-paper`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-paper) | Simple | 1 extension (3 tools), 1 skill | Manifest only, no routes/UI |
| [`plugin-youtube`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-youtube) | Medium | 1 extension (2 tools), 1 skill | Routes + content panel (video player) |
| [`plugin-news`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-news) | Full | 1 extension (5 tools), 1 skill | Routes + own SQLite DB + feed dashboard |
| [`plugin-book`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-book) | Full | 1 extension (1 tool), 3 skills | File parsers + processing pipeline |

Start with `plugin-paper` as a template — it's the simplest end-to-end plugin.
