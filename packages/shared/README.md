# @pi-tree/shared — Shared Types

App-level TypeScript types shared between all packages. No runtime code — types only.

## Why a separate package

Types like `Source`, `UserInfo`, and `SessionContext` are needed by both the server (DB queries, API responses) and the client (rendering, API calls). Extracting them avoids circular dependencies between `@pi-tree/server` and `@pi-tree/client`.

## What lives here vs. `@pi-tree/core/types`

| Package | Contains | Safe for browser? |
|---------|----------|-------------------|
| **`@pi-tree/shared`** | App-level: users, sources, library, config, outlines | ✅ Yes |
| **`@pi-tree/core/types`** | Session-level: `ChatMessage`, `TreeNodeView`, `BranchOption`, `SessionState` | ✅ Yes |

Rule of thumb: if it's about *what the user sees in the chat*, it's in `core/types`. If it's about *what the app manages* (sources, users, config), it's here.

## Exported types

| Type | Description |
|------|-------------|
| `UserInfo` | User identity (slug id, displayName, avatarUrl) |
| `Source` | Universal "thing you have conversations about" |
| `SourceType` | `'book' \| 'news' \| 'paper' \| 'podcast'` |
| `BookMetadata` / `NewsMetadata` | Type-specific metadata stored in `sources.metadata` JSON |
| `SessionContext` | Mode, optional skill/model overrides for a session |
| `SourceSession` / `RecentSession` | Session metadata for listings |
| `TopicNode` | Tree node in the conversation |
| `ReadingTree` | Full tree structure |
| `Source` / `ContentAnchor` | Source metadata and reading position |
| `OutlineEntry` / `SourceOutline` | Book structural analysis |
| `SummaryConfig` / `CompactionConfig` | Per-source configuration |
| `ServerConfig` / `DEFAULT_SERVER_CONFIG` | Server configuration shape + defaults |

## Usage

```typescript
import type { Source, UserInfo, SourceType } from "@pi-tree/shared";
```

## Package boundaries

- ✅ Safe to import from: `@pi-tree/server`, `@pi-tree/client`, `@pi-tree/core`, `@pi-tree/mcp`, `@pi-tree/ui`
- ❌ Must NOT import from: any other `@pi-tree/*` package (shared is a leaf dependency)
