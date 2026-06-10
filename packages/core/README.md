# @pi-tree/core

Pure library — Pi SDK wrapper, conversation tree, session types. **No `process.env`, no file I/O.** All config injected via `PiSessionConfig`.

## Files

```
src/
  index.ts                        — re-exports session/ + types/
  session/
    pi-session.ts         (1029L) — PiSession: wraps Pi SDK, conversation lifecycle
    model-setup.ts         (121L) — configureModelRegistry(): provider/model setup
    conversation-tree.ts    (74L) — ConversationTree: builds tree from Pi SDK data
    tree-nav.ts            (214L) — findNode, getPath, getBreadcrumbs, getChildren
    tree-filter.ts          (37L) — isAbandoned, filterAbandonedNodes
    streaming-utils.ts      (27L) — wrapTokenWithEarlyTreeUpdate
    index.ts                       — barrel export
  types/
    tree.ts                        — TreeNodeView, ChatMessage, BranchOption, BreadcrumbItem, ContentAnchor, SessionState
    message.ts                     — TopicMeta, SectionStatusMeta, SectionLabelMeta, PiTreeData, AnnotatedTreeNode
    index.ts                       — barrel export
```

## Sub-path exports

```typescript
// Full library (server-side only — imports Pi SDK)
import { PiSession, ConversationTree } from "@pi-tree/core";

// Types only (safe for browser bundles)
import type { ChatMessage, TreeNodeView, SessionState } from "@pi-tree/core/types";

// Session module
import { PiSession, configureModelRegistry } from "@pi-tree/core/session";
```

## Boundary

- **May import**: `@pi-tree/shared`, `@earendil-works/pi-coding-agent`
- **Must NOT**: `process.env`, `import.meta.dirname`, `node:fs`, any server imports
- **`@pi-tree/core/types`** sub-path is safe for browser — no Pi SDK dependency

## Tests

```
src/session/__tests__/
  model-setup.test.ts    — 15 tests, model registry configuration
```
