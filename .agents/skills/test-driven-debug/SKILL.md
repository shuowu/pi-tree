---
name: test-driven-debug
description: >
  Debug unexpected behavior by writing a failing test first, then using it to
  locate and fix the root cause. Invoke when the user reports a bug, unexpected
  behavior, or says "fix", "debug", "something is wrong", "not working as expected",
  or describes a scenario that doesn't match expected output.
---

# Test-Driven Debug

Fix bugs by writing a failing test that reproduces the issue, then following the
failure to the root cause.

## Workflow

```
1. Understand → 2. Locate → 3. Test → 4. Run (expect fail) → 5. Fix → 6. Run (expect pass) → 7. Verify
```

### 1. Understand the Scenario

- Ask the user to describe: **input state**, **action**, **actual result**, **expected result**.
- Map it to concrete data structures (tree shapes, DB rows, API payloads).
- Identify which layer owns the behavior (core pure logic, server orchestration, client state).

### 2. Locate the Code Path

Use the architecture guide from `AGENTS.md` to find the relevant code:

| Layer | What to look at |
|-------|-----------------|
| **Core logic** (`@pi-tree/core`) | Pure functions in `packages/core/src/session/tree-nav.ts`, `pi-session.ts` |
| **Server orchestration** | `packages/server/src/services/tree-manager.ts` — `handleMessage`, `handleMessageStreaming` |
| **API routing** | `packages/server/src/routes/session.ts` — how params are passed through |
| **Client state** | `packages/client/src/hooks/useReaderSession.ts` — how `viewNodeId` is tracked and sent |
| **Client streaming** | `packages/client/src/StreamContext.tsx` — how results are applied |

Trace the data flow end-to-end: **client sends → server receives → core decides → server responds → client applies**.

### 3. Write a Failing Test

Choose the right test file based on the layer:

| Layer | Test file | Test style |
|-------|-----------|------------|
| Core pure functions | `packages/core/src/session/__tests__/tree-nav.test.ts` | Direct function calls on `TreeNodeView` structures |
| Core view tracking | `packages/core/src/session/__tests__/viewnode-tracking.test.ts` | Scenario-based with manual trees |
| Core fork/branch | `packages/core/src/session/__tests__/fork-branch.test.ts` | Unit + integration with `SessionManager.inMemory()` |
| Server orchestration | `packages/server/src/__tests__/tree-manager-branching.test.ts` | Mock `PiSession` via `TreeManager._createForTest()` |
| Server API routes | `packages/server/src/__tests__/api-smoke.test.ts` | In-process HTTP via Hono `app.request()` |

#### Test structure for server branching tests

Use the existing mock infrastructure in `tree-manager-branching.test.ts`:

```typescript
// 1. Build the tree state BEFORE the action
const tree = [
  aUserNode("p1", "msg", [
    aAINode("AI_p1", "resp", [/* children */], { isCurrent: true }),
  ], { isCurrent: true }),
];

// 2. Build the expected tree AFTER the action (postSendTree)
const postTree = [/* ... */];

// 3. Create mock and tree manager
const mock = createMockPiSession({
  annotatedTree: tree,
  postSendTree: postTree,
  contentEntries: [["id", "role", "content"], ...],
});
const tm = createTreeManager(mock);

// 4. Perform the action
const result = await tm.handleMessage("msg", viewNodeId, opts);

// 5. Assert the branching decision
expect(mock.simpleBranch).toHaveBeenCalledWith("expected_branch_id");
// Or: expect(mock.simpleBranch).not.toHaveBeenCalled();

// 6. Assert the returned state
expect(result.viewNodeId).toBe("expected_scope");
expect(result.branches.length).toBe(expectedCount);
```

#### Key helpers available

- `aUserNode(id, label, children, overrides)` — user message node
- `aAINode(id, label, children, overrides)` — AI response node (auto-prefixes `✦`)
- `createMockPiSession({ annotatedTree, postSendTree, contentEntries })` — mock PiSession
- `createTreeManager(mock)` — wraps mock in `TreeManager._createForTest()`

#### Mark `isCurrent` correctly

PiSession sets `isCurrent: true` on **all nodes from root to the active leaf**
(the entire current path). The deepest node is the actual leaf.
`findCurrentNode()` returns the deepest `isCurrent` node.

### 4. Run — Expect Failure

```bash
cd packages/server  # or packages/core
npx vitest run src/__tests__/<test-file>.test.ts --reporter=verbose
```

The test **must fail**. If it passes, the bug is elsewhere (different layer, different
scenario, or race condition). Revise your understanding and try again.

### 5. Fix the Bug

With a failing test pointing to the exact function, fix the root cause.
Common patterns:

- **Guard clause skipping logic**: `if (x)` when `x` can be `null` — add fallback resolution
- **Wrong scope resolution**: `viewNodeId` vs `effectiveViewNodeId` vs tree root
- **Descendant check mismatch**: `isDescendantOf` returning wrong result for edge cases
- **Missing branch detection**: `shouldBranchFromScope` not checking enough conditions

### 6. Run — Expect Pass

```bash
npx vitest run src/__tests__/<test-file>.test.ts --reporter=verbose
```

All tests must pass, including the new ones.

### 7. Verify — Full Suite + Dev Server

```bash
# Run full test suite (from repo root)
npx vitest run --exclude="e2e/**" --exclude="**/dist/**"

# Restart dev server if it's running in tmux
tmux capture-pane -t pi-tree:0.0 -p | tail -5   # check current state
tmux send-keys -t pi-tree:0.0 C-c                # stop
sleep 1
tmux send-keys -t pi-tree:0.0 'npm run dev' Enter # restart
```

Then tell the user to test with a **new session** (existing sessions may have
persisted state from before the fix).

## Anti-patterns

- ❌ **Don't fix first, test later** — the test should fail before the fix
- ❌ **Don't test the wrong layer** — if the bug is in `handleMessage`, don't test `shouldBranchFromScope` alone
- ❌ **Don't write tests that pass by coincidence** — verify the test actually catches the scenario by checking it fails without the fix
- ❌ **Don't forget `isCurrent` flags** — branching logic depends on knowing the active leaf
- ❌ **Don't skip the streaming variant** — `handleMessage` and `handleMessageStreaming` have parallel branching code; both need testing
