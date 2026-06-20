---
title: Plugin Guide
description: How to build and customize pi-tree plugins — from simple skill overrides to full source type plugins.
---

# Plugin Guide

Pi-tree's plugin system has three levels of customization, from lightest to heaviest:

| Level | What you create | Restart needed? | Use case |
|---|---|---|---|
| **Custom skills** | A `SKILL.md` file | No | Change AI behavior for existing source types |
| **Custom profiles** | A `.yml` file | Yes | New session modes for existing source types |
| **Full plugin** | A package with `package.json` | Yes | New source type with tools, skills, routes, UI |

## Custom Skills (No Code)

Skills are markdown files that shape how the AI behaves. Drop one into `$DATA_PATH/skills/` and it takes effect on the next session — no restart, no build step.

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

Profiles wire skills and extensions together for a specific `(sourceType, mode)` pair. They're YAML files in `$DATA_PATH/profiles/`.

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

A full plugin is a standalone package that provides a new source type with its own tools, skills, profiles, routes, and UI components.

### Plugin structure

```
packages/plugin-example/
├── package.json          # Manifest with piTree config
├── index.ts              # Extension: registers AI tools
├── skills/
│   └── example-reading/
│       └── SKILL.md      # AI behavior instructions
├── profiles/
│   └── example.reading.yml
├── routes.ts             # Optional: HTTP API routes
└── ui/
    └── ContentPanel.tsx  # Optional: right-panel UI component
```

### The manifest (`package.json`)

The `piTree` field declares everything the server needs to discover and wire the plugin:

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

### Manifest fields reference

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
| `pi.extensions` | Paths to extension modules (registers AI tools) |
| `pi.skills` | Paths to skill directories |

### Extension (AI tools)

The extension registers tools that the AI can call during sessions:

```typescript
// index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "search_example",
    label: "Search Example",
    description: "Search for example items by keyword.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    async execute(_toolCallId, params) {
      // Your logic — fetch APIs, query databases, read files, etc.
      const results = await fetchSomething(params.query);
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
        details: undefined,
      };
    },
  });
}
```

### Using plugin SDK services

If your tool needs to interact with pi-tree's core (sources, sessions, users), use `definePiTreeExtension`:

```typescript
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";
import { Type } from "typebox";

export default definePiTreeExtension((pi, services) => {
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

### Available services

| Service | Methods | Use case |
|---|---|---|
| `services.sources` | `list()`, `get(id)`, `create()`, `update()` | Manage sources in the library |
| `services.sessions` | `listForSource()`, `create()`, `getById()` | Manage user sessions |
| `services.users` | `get(id)`, `ensureExists(id)` | User identity |
| `services.registry` | `getProfiles()`, `getSourceTypes()` | Profile introspection |
| `services.getPluginDataDir(name)` | — | Scoped data directory for your plugin |
| `services.dataPath` | — | Root data directory |

### HTTP routes (optional)

Plugins can declare HTTP routes for custom APIs:

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

Plugins can provide a React component for the right sidebar:

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

For real-world examples, see the built-in plugins:

| Plugin | Complexity | Key patterns |
|---|---|---|
| [`plugin-paper`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-paper) | Simple | Tools only (arXiv search), no routes, no UI panel |
| [`plugin-youtube`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-youtube) | Medium | Tools + routes + content panel (video player) |
| [`plugin-news`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-news) | Full | Tools + routes + own SQLite DB + feed dashboard + crawling service |
| [`plugin-book`](https://github.com/shuowu/pi-tree/tree/master/packages/plugin-book) | Full | File parsers + processing pipeline + multiple session modes |

Start with `plugin-paper` as a template — it's the simplest end-to-end plugin.
