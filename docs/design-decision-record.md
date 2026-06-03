# Pi-Reader: Design & Decision Record

## Decision: Unified Overlaid Map (Model D → E)

**Date**: 2026-06-03
**Status**: Accepted

### Context

The app needs to show two things:
1. The book's structure (TOC from outline)
2. The reader's conversation journey (session tree)

### Decision

**Ship Model D** (Overlaid Map): One unified view with two visual layers.
**Evolve to Model E** (Living TOC): Add AI-curated sections incrementally.

Rejected alternatives:
- Model A (TOC constrains tree) — too rigid, kills free exploration
- Model B (independent views) — disconnected mental models
- Model C (auto-grow TOC) — clutters, hard to distinguish book vs reader content

---

## Technical Feasibility — Verified Against Pi SDK

### What Pi SDK provides

| API | What it does | Verified |
|---|---|---|
| `appendCustomEntry(customType, data?)` | Store arbitrary JSON in session | ✅ Any JSON, no size limit. Note: `customType` not `extensionId` |
| `appendCustomMessageEntry(type, content, display, details?)` | Store data AND include in LLM context | ✅ This is how to inject info the AI should see |
| `getTree()` | Returns full tree of ALL entry types | ✅ Includes CustomEntry, LabelEntry, etc. |
| `getEntries()` | Flat list of all entries (excl. header) | ✅ All types |
| `getPath()` / `getBranch(fromId?)` | Root → leaf path / walk from entry to root | ✅ Includes all entry types |
| `getChildren(parentId)` | Direct children of any entry | ✅ All types |
| `branch(entryId)` | Move leaf pointer to earlier entry | ✅ Next append chains from there |
| `branchWithSummary(id, summary)` | Creates BranchSummaryEntry at new position | ✅ Summary is OUR string (programmatic). Pi auto-generates via LLM in `/tree` UI flow |
| `appendLabelChange(targetId, label)` | Attach a label to any entry | ✅ Latest label wins |
| `getContextMessages()` | Build LLM context | ✅ Only messages + BranchSummary + **CustomMessageEntry**. Plain CustomEntry excluded |

### Constraints discovered

| Constraint | Impact | Mitigation |
|---|---|---|
| **Entries are append-only** (JSONL) | Can't update existing metadata | Append new state; filter by "most recent" on read (same as LabelEntry pattern) |
| **CustomEntry not in LLM context** | AI won't see our metadata | Use `appendCustomMessageEntry` for data AI needs. Use `appendCustomEntry` for UI-only metadata |
| **append advances leaf pointer** | Consecutive appends form a chain, not siblings | Use `branch()` back to parent to create siblings at same node |
| **No `get_tree` in RPC mode** | Can't use RPC for tree operations | Already decided: SDK mode, not RPC |

### Each feature traced to SDK calls

#### Model D: Overlaid Map

| Feature | Implementation | SDK calls |
|---|---|---|
| **Show book outline** | Parse `analysis/outline.md` at session start | File read (not SDK) |
| **Mark sections as read** | `appendCustom("pi-reader", { kind: "section_status", line: 225, status: "read" })` | `appendCustom` |
| **Nest tangent under section** | `branch(sectionEntryId)` + `appendCustom("pi-reader", { kind: "topic_node", label, bookAnchor })` | `branch` + `appendCustom` |
| **Show exploration depth (░ vs █)** | Walk `getTree()`, count messages per branch, overlay on outline | `getTree` + `getChildren` |
| **Float cross-book threads** | `appendCustom` with `bookAnchor: undefined` — renders in "Cross-book" section | `appendCustom` |
| **Navigate to any node** | `branch(targetEntryId)` — moves leaf, next message continues there | `branch` |
| **Zoom out with summary** | `branchWithSummary(parentEntryId, summaryText)` — we generate the summary | `branchWithSummary` |
| **Resume session** | `SessionManager.open(sessionFilePath)` | `SessionManager.open` |
| **Get breadcrumb** | `getPath()` → filter for our CustomEntries with `kind: "topic_node"` | `getPath` |

#### Model E: Living TOC (incremental additions)

| Feature | Implementation | Feasible? |
|---|---|---|
| **"Your Threads"** | After every N interactions, run a lightweight prompt on branch summaries: "What themes keep recurring?" Store result as `appendCustom("pi-reader", { kind: "thread", theme, relatedEntries })` | ✅ Just a prompt + custom entry |
| **"Emerging Questions"** | Parse AI responses for unresolved questions (regex or lightweight LLM). Store as `appendCustom("pi-reader", { kind: "question", text, raisedInEntry })` | ✅ Same pattern |
| **"Big Picture" per part** | When all chapters in a Part are completed, run `compact` with custom instructions: "Synthesize Part II into key principles." Store output. | ✅ `compact(customInstructions)` |
| **Reading recommendations** | After a tangent, prompt: "Based on what the reader explored, which unread chapter is most relevant?" Store as `appendCustom("pi-reader", { kind: "recommendation", targetChapter, reason })` | ✅ Prompt + custom entry |
| **Skip annotations** | When user skips a chapter, store `appendCustom("pi-reader", { kind: "skip", line, reason })` | ✅ Trivial |

**All Model E features follow one pattern**: run a prompt → store result as CustomEntry → render in the map. No new SDK capabilities needed.

---

## Data Model: Custom Entries in Pi Session

All pi-reader metadata is stored as `CustomEntry` with `extensionId: "pi-reader"`. The `data` field is typed:

```typescript
// All custom entries stored in the Pi session
type PiReaderCustomData =
  | TopicNodeData       // A reading topic (chapter, tangent, cross-book)
  | SectionStatusData   // Mark an outline section as read/skipped
  | ThreadData          // AI-detected recurring theme (Model E)
  | QuestionData        // Unresolved question (Model E)
  | RecommendationData  // AI reading recommendation (Model E)
  | BigPictureData;     // Part/book level synthesis (Model E)

// ── Model D (ship first) ──

interface TopicNodeData {
  kind: "topic_node";
  label: string;
  source: "outline" | "user" | "auto";
  status: "active" | "completed" | "abandoned";
  bookAnchor?: {
    lineRange: [number, number];
    outlineHeading?: string;
  };
}

interface SectionStatusData {
  kind: "section_status";
  outlineLine: number;       // References the outline entry
  status: "reading" | "read" | "skipped";
  messageCount: number;
}

// ── Model E (add incrementally) ──

interface ThreadData {
  kind: "thread";
  theme: string;             // "Leadership under uncertainty"
  description: string;
  relatedEntryIds: string[]; // Links to entries across branches
  detectedAt: string;        // ISO timestamp
}

interface QuestionData {
  kind: "question";
  text: string;              // "How does BW work in low-trust teams?"
  raisedInEntryId: string;
  status: "open" | "answered";
  answeredInEntryId?: string;
}

interface RecommendationData {
  kind: "recommendation";
  targetChapter: string;     // "Chapter 7: People Are Wired Differently"
  targetLine: number;
  reason: string;            // "Directly addresses your question about trust"
}

interface BigPictureData {
  kind: "big_picture";
  scope: string;             // "Part II" or "Whole Book"
  synthesis: string;         // The AI-generated synthesis
}
```

### Reading the map: how to reconstruct the unified view

```typescript
function buildUnifiedMap(
  outline: OutlineEntry[],      // From book-outline (static)
  piTree: PiTreeNode[],         // From sessionManager.getTree()
): UnifiedMapNode[] {

  // 1. Start with the outline as the skeleton
  const map = outline.map(entry => ({
    ...entry,
    status: "unread" as const,
    branches: [] as AnnotatedTreeNode[],
    threads: [] as ThreadData[],
    questions: [] as QuestionData[],
  }));

  // 2. Walk the Pi tree, find our CustomEntries
  const allCustom = flattenTree(piTree)
    .filter(n => n.entry.extensionId === "pi-reader");

  // 3. For each TopicNodeData with a bookAnchor, nest it under the matching outline entry
  for (const node of allCustom) {
    const data = node.entry.data as PiReaderCustomData;
    if (data.kind === "topic_node" && data.bookAnchor) {
      const outlineEntry = findByLineRange(map, data.bookAnchor.lineRange);
      if (outlineEntry) {
        outlineEntry.branches.push(annotate(node));
        outlineEntry.status = data.status === "completed" ? "read" : "reading";
      }
    }
  }

  // 4. TopicNodes WITHOUT bookAnchor go to "floating" sections
  //    (cross-book, meta-threads, etc.)
  const floating = allCustom
    .filter(n => (n.entry.data as TopicNodeData).kind === "topic_node"
                 && !(n.entry.data as TopicNodeData).bookAnchor);

  // 5. ThreadData, QuestionData, etc. go to their respective UI sections
  const threads = allCustom
    .filter(n => (n.entry.data as PiReaderCustomData).kind === "thread");
  const questions = allCustom
    .filter(n => (n.entry.data as PiReaderCustomData).kind === "question");

  return { map, floating, threads, questions };
}
```

### Append-only metadata updates

Since JSONL is append-only, "updating" a node's status means appending a new entry:

```typescript
// Mark a section as completed
function markCompleted(sm: SessionManager, topicEntryId: string) {
  // Append a NEW custom entry that supersedes the old one
  sm.appendCustom("pi-reader", {
    kind: "section_status_update",
    targetEntryId: topicEntryId,
    newStatus: "completed",
    timestamp: new Date().toISOString(),
  });
}

// When reading back, use latest-wins:
function getStatus(entries: PiSessionEntry[], targetId: string): string {
  const updates = entries
    .filter(e => e.extensionId === "pi-reader"
              && (e.data as any).kind === "section_status_update"
              && (e.data as any).targetEntryId === targetId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return updates[0]?.data?.newStatus ?? "active";
}
```

This follows the same pattern as Pi's own `LabelEntry` (latest label for a targetId wins).

---

## Architecture: Where Each Piece Lives

```
┌─────────────────────────────────────────────────────────┐
│ Client                                                   │
│                                                          │
│ ┌──────────────┐  ┌────────────────────────────────────┐│
│ │ Unified Map  │  │ Chat View                          ││
│ │ (sidebar)    │  │                                    ││
│ │              │  │ Messages from Pi via SSE stream     ││
│ │ Outline +    │  │                                    ││
│ │ Branches +   │  │ Breadcrumb bar                     ││
│ │ Threads +    │  │                                    ││
│ │ Questions    │  │ Zoom controls                      ││
│ └──────┬───────┘  └─────────────┬──────────────────────┘│
│        │ click/navigate         │ send message           │
└────────┼────────────────────────┼────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│ Server (thin orchestration)                              │
│                                                          │
│ ┌─────────────────┐  ┌──────────────────────────────┐   │
│ │ Intent          │  │ Map Builder                   │   │
│ │ Classifier      │  │                               │   │
│ │                 │  │ buildUnifiedMap(outline, tree) │   │
│ │ continue?       │  │ Merges outline + Pi tree +    │   │
│ │ go_deeper?      │  │ custom metadata               │   │
│ │ zoom_out?       │  │                               │   │
│ └────────┬────────┘  └──────────────┬────────────────┘   │
│          │                          │                     │
│          ▼                          ▼                     │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Pi SDK (does the heavy lifting)                     │   │
│ │                                                     │   │
│ │ SessionManager: tree, branch, getTree, append       │   │
│ │ AgentSession: prompt, subscribe, streaming          │   │
│ │ ResourceLoader: skills auto-discovery               │   │
│ │ Context building: compaction, branch summaries      │   │
│ └─────────────────────┬──────────────────────────────┘   │
│                       │                                   │
│                       ▼                                   │
│              ┌────────────────┐                           │
│              │ Session JSONL  │ ← all state here          │
│              │ (per book)     │   messages + custom data   │
│              └────────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

**No separate database.** Everything lives in Pi's session JSONL file: messages, tree structure, our custom metadata (topic nodes, threads, questions, recommendations). One file per book session.

---

## Implementation Roadmap

### Phase 1: Model D — Overlaid Map (ship first)

```
Server:
  ✅ PiSession wraps Pi SDK (done — mock in place)
  ✅ TreeManager classifies intent (done)
  ✅ LibraryService reads outline (done)
  □  MapBuilder: merge outline + tree into unified map
  □  Custom entry CRUD: topic_node, section_status
  □  Pi SDK integration: uncomment real SDK code, install package

Client:
  □  Unified Map sidebar (outline + branches + progress indicators)
  □  Chat view with breadcrumb
  □  Click-to-navigate (map → chat)
  □  Zoom in/out controls
```

### Phase 2: Model E — Living TOC (incremental)

Each is a standalone feature:

```
□  "Your Threads" — theme detection prompt after every ~10 interactions
□  "Emerging Questions" — parse AI responses for unresolved questions
□  "Big Picture" — synthesis prompt when a Part is completed
□  "Recommendations" — prompt after tangents: "what should they read next?"
□  "Skip annotations" — store reason when chapters are skipped
```

### Phase 3: Polish

```
□  Configurable map (BOOK.md: show_threads, show_questions, etc.)
□  Collapse/expand completed sections
□  Search across all branches
□  Export reading journey as structured notes
```

---

## Summary of Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **TOC model** | Overlaid Map (D) → Living TOC (E) | Single unified view; Model E is additive, not a redesign |
| **Storage** | Pi session JSONL (no separate DB) | All state in one file; CustomEntry stores our metadata |
| **Metadata pattern** | Append-only with latest-wins reads | Matches Pi's own pattern (LabelEntry); JSONL constraint |
| **SDK mode** | Direct SDK import (not RPC) | Need `branch`, `getTree`, `getChildren` — not in RPC |
| **Server role** | Thin: intent classification + map building | Pi handles everything else |
| **Skills** | Auto-discovered from pi-books `.pi/skills/` | `DefaultResourceLoader({ cwd: piBooksCwd })` |
| **AI context** | CustomEntry NOT in LLM context | AI sees messages only; our metadata is for the UI. Inject map summary via steer message when needed |
| **Model E features** | Each follows: prompt → store as CustomEntry → render | No new SDK APIs needed; just prompt engineering + storage |
