# @pi-tree/ui — React Component Library

Reusable React components for the pi-tree chat interface. All components use the `pit-` CSS class prefix and are designed to be generic and prop-driven.

## Components

| Component | Description |
|-----------|-------------|
| `ChatView` | Full chat interface — messages, input, branches, streaming |
| `Breadcrumb` | Navigation breadcrumb bar with panel toggles |
| `MessageBubble` | Single message render (user / assistant / toolResult) |
| `StreamingBubble` | Streaming AI response with cursor animation |
| `InlineBranches` | Branch preview cards with expand/collapse |
| `ToolCallIndicator` | Tool execution spinner |

## Hooks

| Hook | Description |
|------|-------------|
| `useMermaid` | Renders mermaid diagrams embedded in markdown content |
| `useScrollDirection` | Tracks scroll direction for shy-header UX pattern |

## Design principles

**Prop-driven, no app dependencies.** Components never make API calls or read env vars. All app-specific concerns are injected via props:

```tsx
<ChatView
  renderSelectionToolbar={...}   // render prop
  fetchBranchPreview={...}       // callback
  modelName="glm-5-turbo"        // data
  userId="shuo"                  // identity
/>
```

**Self-contained CSS.** Components import their own stylesheets — no separate CSS imports needed by consumers.

## CSS conventions

- **Class prefix**: `pit-` (e.g. `.pit-chat-view`, `.pit-breadcrumb-bar`)
- **Design tokens**: `--pit-*` custom properties (e.g. `--pit-accent`, `--pit-space-4`)
- **Theme file**: `src/styles/pit-theme.css` bridges host app tokens to `pit-*` namespaced properties with sensible defaults

### Theming

Consumers can:
1. Use defaults (works out of the box)
2. Override `--pit-*` properties for custom theming
3. (Future) Import only hooks for fully headless usage

## Package boundaries

| May import | Must NOT do |
|-----------|-------------|
| `@pi-tree/core/types`, React, lucide-react, marked, mermaid | App-specific API calls, env vars, server imports |

## Usage

```tsx
import { ChatView, Breadcrumb, useMermaid } from "@pi-tree/ui";
```
