# @pi-tree/ui

React component library for the chat interface. Generic, prop-driven — no API calls, no env vars.

## Files

```
src/
  index.ts                  — barrel export
  ChatView.tsx              — full chat: messages, input, branches, streaming
  Breadcrumb.tsx            — navigation bar with panel toggles
  MessageBubble.tsx         — single message (user/assistant/toolResult)
  StreamingBubble.tsx       — streaming AI response with cursor animation
  InlineBranches.tsx        — branch preview cards, expand/collapse
  ToolCallIndicator.tsx     — tool execution spinner
  hooks/
    useMermaid.ts           — renders mermaid diagrams in markdown
    useScrollDirection.ts   — tracks scroll for shy-header UX
  styles/
    pit-theme.css           — design tokens (--pit-*), bridges host app tokens
    ChatView.css            — chat component styles
    Breadcrumb.css          — breadcrumb component styles
```

## Exports

```typescript
// Components
import { ChatView, Breadcrumb, MessageBubble, StreamingBubble,
         InlineBranches, ToolCallIndicator } from "@pi-tree/ui";

// Hooks
import { useMermaid, useScrollDirection } from "@pi-tree/ui";

// Types
import type { BranchPreviewData, ScrollDirection } from "@pi-tree/ui";
```

## CSS conventions

- Class prefix: `pit-` (e.g. `.pit-chat-view`, `.pit-breadcrumb-bar`)
- Design tokens: `--pit-*` custom properties
- Components import their own CSS — no separate imports needed
- Override `--pit-*` properties for custom theming

## Prop-driven design

Components take callbacks and render props for app-specific behavior:

```tsx
<ChatView
  renderSelectionToolbar={...}  // render prop
  fetchBranchPreview={...}      // callback
  modelName="glm-5-turbo"       // data
  userId="shuo"                 // identity
/>
```

## Boundary

- **May import**: `@pi-tree/core/types`, React, lucide-react, marked, mermaid
- **Must NOT**: API calls, env vars, server imports, `@pi-tree/core` main entry
