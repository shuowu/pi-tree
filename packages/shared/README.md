# @pi-tree/shared

App-level types shared across all packages. Types only — no runtime code.

## Files

```
src/
  index.ts          — re-exports types.ts
  types.ts          — all type definitions
```

## Exports

Types — users, sources, sessions, config:

```
UserInfo, SourceType, Source, BookMetadata, NewsMetadata,
SessionContext, SourceSession, RecentSession,
TopicNode, ContentAnchor, ReadingTree,
BookPreferences, ReaderConfig, DEFAULT_CONFIG,
OutlineEntry, SourceOutline, ThematicMapEntry, ReadingRecommendation,
SummaryDetailLevel, SummaryFocus, SummaryConfig, CompactionConfig,
NavigationConfig, LookupConfig,
ServerConfig, DEFAULT_SERVER_CONFIG,
UserIntent
```

## Import

```typescript
import type { Source, UserInfo, SourceType } from "@pi-tree/shared";
```

## Boundary

- **May import**: nothing (leaf dependency)
- **Importable by**: every other `@pi-tree/*` package
- **vs `@pi-tree/core/types`**: shared has app-level types (sources, users, config); core/types has session-level types (ChatMessage, TreeNodeView, SessionState)
