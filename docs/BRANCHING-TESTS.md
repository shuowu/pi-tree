# Linear-First Branching — Implementation Status & Test Plan

> Branch: `dev/linear-first-branching`
> Base: `fadf22d` (master: `31c8172`)

## Design Rules

Messages follow these rules **recursively at any tree depth**:

| # | Condition | Action |
|---|-----------|--------|
| 1 | `forceBranch` (explicit ⑂ fork button) | Always branch from AI node |
| 2 | AI node has **2+ children** (existing fork point) | Auto-branch (add sibling) |
| 3 | Current leaf **is descendant** of AI node | Linear continuation at leaf |
| 4 | Current leaf **is NOT descendant** | Branch (navigated away) |

## Commits So Far

| Commit | What |
|--------|------|
| `fadf22d` | Linear-first branching: `shouldBranchFromScope`, `findBranchPoint`, tests |
| `bd694b5` | Fork button (⑂): `forceBranch` option, `MessageBubble` fork UI, scope redirect |
| `f37ec5e` | Fix `findCurrentNode`: return deepest leaf (PiSession marks entire path `isCurrent`) |
| `6ff4aa8` | Auto-branch at existing fork points (2+ children) |
| `209b9da` | Fix viewNodeId always null — server now resolves scope from current leaf |

## Known Issues (Still Open)

### Issue 1: Fork from mid-thread AI message

**Scenario**: Linear thread `p-1 → c-1 → c-2 → c-3`. User forks from AI_c2.

```
Before:
  p-1 → AI_p1 → c-1 → AI_c1 → c-2 → AI_c2 → c-3 → AI_c3

Expected after fork:
  p-1 → AI_p1 → c-1 → AI_c1 → c-2 → AI_c2 ─┬─ c-3 → AI_c3  (original)
                                                └─ [new msg]    (forked)

Viewing p-1 scope should show:
  Messages: p-1, AI_p1, c-1, AI_c1, c-2, AI_c2
  Branch cards: [c-3 path], [new fork path]
```

**Status**: Core logic (`shouldBranchFromScope`, `collectScopeMessages`) handles this correctly per unit tests. The end-to-end flow through `TreeManager.handleMessageStreaming` is untested.

### Issue 2: Linear continuation within a branch

**Scenario**: After fork, keep messaging in the forked branch.

```
  AI_c2 ─┬─ c-3 → AI_c3               (original branch)
          └─ c-new → AI_new → c-4 → AI_4  (forked, user keeps messaging)

Expected:
  - c-4 appends linearly after AI_new (no new branches created)
  - No branches created at AI_c2 or AI_p1 level
  - shouldBranchFromScope(tree, "c-new") → { shouldBranch: false }
```

**Status**: Core logic correct per unit tests. End-to-end flow untested.

## Test Coverage

### ✅ Well-Tested: `tree-nav.ts` (122 tests)

All 9 exported pure functions have thorough unit tests:
- `shouldBranchFromScope` — 17+ scenarios
- `collectScopeMessages` — 23+ tests (linear, fork, nested, branch cards)
- `findCurrentNode` — 8 tests (including PiSession-style `isCurrent`)
- `findBranchPoint` — 21 tests
- `isDescendantOf`, `findNode`, `findParent`, `isAINode`, `buildBreadcrumb`

### ✅ Now Tested: `tree-manager.ts` (29 tests)

The orchestration layer is tested via `tree-manager-branching.test.ts` using a
mock PiSession injected through `TreeManager._createForTest()`:

| Method | Tests | What's covered |
|--------|-------|----------------|
| `handleMessage` | 10 | forceBranch, linear continuation, auto-branch at fork, viewNodeId=null resolution, nonexistent node |
| `handleMessageStreaming` | 4 | forceBranch parity, linear continuation, auto-branch, viewNodeId=null scope resolution |
| `getSessionState` / `buildScopedState` | 6 | State shape, messages chain, fork branches, breadcrumb, null viewNodeId, nonexistent viewNodeId |
| `navigateTo` | 3 | branchAt dispatch, branchWithSummary, valid state return |
| `buildTreeView` / `annotatedToView` | 3 | Empty tree fallback, AnnotatedTreeNode→TreeNodeView mapping, parentId normalization |
| `deleteNode` / `renameNode` | 2 + 1 | updateStatus/updateLabel delegation |

## Test Plan: Phase 1 — Branching Pipeline

### Approach: Extract orchestration logic

`TreeManager.handleMessage/handleMessageStreaming` mix branching decisions with
PiSession side effects. Extract a pure `resolveBranchAction(tree, viewNodeId, opts)` 
function that returns the decision, then test it independently.

Alternatively: test through `handleMessage` with a mock/stub PiSession.

### Required Tests

#### 1a. Fork from mid-thread (Issue 1)

```
Tree (linear):  p1 → AI_p1 → c1 → AI_c1 → c2 → AI_c2 → c3 → AI_c3
Action:         forceBranch from AI_c2
Expect:         simpleBranch("AI_c2") called
Post-fork tree: AI_c2 has 2 children (c3 + new)
View from p1:   messages up to AI_c2, then 2 branch cards
```

#### 1b. Linear continuation in fork (Issue 2)

```
Tree (forked):  AI_c2 ─┬─ c3 → AI_c3
                        └─ c_new → AI_new (current leaf)
Action:         message from c_new scope (viewNodeId = c_new)
Expect:         shouldBranch = false, no simpleBranch call
                message appends at leaf linearly
```

#### 1c. Auto-branch at existing fork point

```
Tree (forked):  AI_c2 ─┬─ c3 → AI_c3
                        └─ c_new → AI_new (current leaf)
Action:         message from p1 scope (viewNodeId = p1)
                findBranchPoint(p1) = AI_p1, AI_p1 has 1 child → NOT a fork point
                BUT: walk reaches AI_c2 which has 2+ children...
                Actually findBranchPoint(p1) = AI_p1 (first AI child of p1)
                AI_p1 has 1 child → shouldBranch depends on descendant check
Expect:         shouldBranch = false (current leaf IS descendant of AI_p1)
```

#### 1d. Multiple forks from same node

```
Tree:           AI_c2 ─┬─ c3 → AI_c3
                        ├─ fork_1 → AI_f1
                        └─ fork_2 → AI_f2 (current)
Action:         message from c2 scope (viewNodeId = c2)
                findBranchPoint(c2) = AI_c2, which has 3 children
Expect:         shouldBranch = true, branchId = AI_c2 (auto-branch at fork)
```

#### 1e. viewNodeId null → scope resolved from current leaf

```
Tree:           p1 → AI_p1 → c1 → AI_c1 (current leaf)
Action:         handleMessage(msg, null)
Expect:         No branching (viewNodeId is null)
                Response.viewNodeId is NOT null (resolved from current leaf)
                Response.viewNodeId = c1 (parent of AI_c1)
```

#### 1f. forceBranch + viewNodeId

```
Tree:           p1 → AI_p1 → c1 → AI_c1 → c2 → AI_c2 (current)
Action:         handleMessage(msg, "AI_c1", { forceBranch: true })
Expect:         simpleBranch("AI_c1") called (AI_c1 is the branchPoint)
                Response viewNodeId points into new branch
```

#### 1g. forceBranch but findBranchPoint returns null

```
Action:         handleMessage(msg, "nonexistent", { forceBranch: true })
Expect:         No crash, no simpleBranch call
```

### Phase 2 — State Composition

- `buildScopedState` returns correct `SessionState` shape
- `viewNodeId=null` → `breadcrumb=[]`  
- `viewNodeId` valid → breadcrumb has path from root
- `messages` and `branches` match `collectScopeMessages` output

### Phase 3 — Navigation

- `navigateTo` calls correct PiSession method
- Returns valid state after navigation
- Invalid targetNodeId handled gracefully
