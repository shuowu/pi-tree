# @pi-tree/core — Pure Library

Pi SDK wrapper and session/tree types. **Pure library** — no `process.env`, no `import.meta.dirname`, no file I/O.

## Key constraint

All environment resolution (API keys, model names, paths) happens in the server's app layer and is injected via `PiSessionConfig`. This keeps core testable and free of side effects.

## Sub-path exports

```typescript
// Full library — PiSession, tree operations, model setup (server-side only)
import { PiSession } from "@pi-tree/core";

// Types only — safe for browser bundles
import type { ChatMessage, TreeNodeView, SessionState } from "@pi-tree/core/types";

// Session module — PiSession + tree utilities
import { PiSession, ConversationTree } from "@pi-tree/core/session";
```

## Modules

### `session/` — Pi SDK wrapper and tree operations

| File | What it does |
|------|-------------|
| `pi-session.ts` | `PiSession` — wraps Pi SDK, manages conversation lifecycle, resource loading |
| `model-setup.ts` | `configureModelRegistry()` — extracted, testable model/provider setup |
| `conversation-tree.ts` | `ConversationTree` — builds tree structure from Pi SDK conversation |
| `tree-nav.ts` | Tree navigation utilities (find node, get path, breadcrumbs) |
| `tree-filter.ts` | Filter/search within conversation trees |
| `streaming-utils.ts` | SSE streaming helpers |

### `types/` — Session-level types (browser-safe)

| Type | Description |
|------|-------------|
| `TreeNodeView` | A node in the conversation tree (UI-ready) |
| `ChatMessage` | Single message (user/assistant/toolResult) |
| `BranchOption` | Branch preview card data |
| `BreadcrumbItem` | Navigation breadcrumb entry |
| `SessionState` | Current session state snapshot |
| `ContentAnchor` | Reading position reference |
| `AnnotatedTreeNode` | Tree node with Pi SDK metadata annotations |

## Package boundaries

| May import | Must NOT do |
|-----------|-------------|
| `@pi-tree/shared`, `@earendil-works/pi-coding-agent` | `process.env`, `import.meta.dirname`, file I/O, any server imports |

## Tests

```bash
cd packages/core
npm test          # vitest
```

Tests use `vi.stubEnv` to mock environment — no real env vars needed.
