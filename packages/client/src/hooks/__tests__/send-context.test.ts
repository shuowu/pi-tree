import { describe, it, expect } from "vitest";
import {
  resolveSendContext,
  resolveStreamDoneAction,
  shouldApplyStreamResult,
} from "../send-context";

// =============================================================================
// resolveSendContext — determines sendingNodeId, forceBranch, and ref update
// =============================================================================

describe("resolveSendContext", () => {
  // -------------------------------------------------------------------------
  // Normal (non-fork) sends
  // -------------------------------------------------------------------------

  it("uses lastViewNodeId when no fork scope is pending", () => {
    const result = resolveSendContext(null, "node_A");

    expect(result.sendingNodeId).toBe("node_A");
    expect(result.forceBranch).toBe(false);
    expect(result.nextLastViewNodeId).toBe("node_A");
  });

  it("handles null lastViewNodeId (root scope)", () => {
    const result = resolveSendContext(null, null);

    expect(result.sendingNodeId).toBeNull();
    expect(result.forceBranch).toBe(false);
    expect(result.nextLastViewNodeId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Fork sends — the bug scenario
  // -------------------------------------------------------------------------

  it("uses forkScope as sendingNodeId when fork is pending", () => {
    const result = resolveSendContext("fork_parent", "viewed_child");

    expect(result.sendingNodeId).toBe("fork_parent");
    expect(result.forceBranch).toBe(true);
  });

  it("syncs lastViewNodeId to forkScope so done-handler guard passes (the bug fix)", () => {
    // This is the core regression test.
    //
    // Before the fix:
    //   sendingNodeId = "fork_parent"
    //   nextLastViewNodeId = "viewed_child"  (unchanged)
    //   → done handler: "viewed_child" === "fork_parent" → FALSE → result never applied
    //
    // After the fix:
    //   nextLastViewNodeId = "fork_parent"  (synced)
    //   → done handler: "fork_parent" === "fork_parent" → TRUE → result applied ✓

    const result = resolveSendContext("fork_parent", "viewed_child");

    expect(result.nextLastViewNodeId).toBe("fork_parent");
    // Verify the done-handler guard would pass:
    expect(result.nextLastViewNodeId).toBe(result.sendingNodeId);
  });

  it("handles fork from root scope", () => {
    const result = resolveSendContext("fork_parent", null);

    expect(result.sendingNodeId).toBe("fork_parent");
    expect(result.forceBranch).toBe(true);
    expect(result.nextLastViewNodeId).toBe("fork_parent");
  });
});

// =============================================================================
// shouldApplyStreamResult — the done-handler guard
// =============================================================================

describe("shouldApplyStreamResult", () => {
  it("returns true when lastViewNodeId matches sendingNodeId", () => {
    expect(shouldApplyStreamResult("node_A", "node_A")).toBe(true);
  });

  it("returns true when both are null", () => {
    expect(shouldApplyStreamResult(null, null)).toBe(true);
  });

  it("returns false when user navigated away (IDs differ)", () => {
    expect(shouldApplyStreamResult("node_B", "node_A")).toBe(false);
  });

  it("returns false when lastViewNodeId is null but sendingNodeId is not", () => {
    expect(shouldApplyStreamResult(null, "node_A")).toBe(false);
  });

  it("returns false when sendingNodeId is null but lastViewNodeId is not", () => {
    expect(shouldApplyStreamResult("node_A", null)).toBe(false);
  });
});

// =============================================================================
// resolveStreamDoneAction — auto-nav vs notify on stream completion
// =============================================================================

describe("resolveStreamDoneAction", () => {
  it("applies (auto-navs) when the user is still following a branching result", () => {
    expect(
      resolveStreamDoneAction({
        lastViewNodeId: "node_A",
        sendingNodeId: "node_A",
        resultViewNodeId: "new_branch",
        isFollowing: true,
      }),
    ).toBe("apply");
  });

  it("stays and notifies when the user scrolled away and the result branched", () => {
    expect(
      resolveStreamDoneAction({
        lastViewNodeId: "node_A",
        sendingNodeId: "node_A",
        resultViewNodeId: "new_branch",
        isFollowing: false,
      }),
    ).toBe("stay-notify");
  });

  it("applies a non-branching result even when the user scrolled away", () => {
    // Same-node completion doesn't move the view, so scroll position is
    // preserved by ChatView — no need to suppress.
    expect(
      resolveStreamDoneAction({
        lastViewNodeId: "node_A",
        sendingNodeId: "node_A",
        resultViewNodeId: "node_A",
        isFollowing: false,
      }),
    ).toBe("apply");
  });

  it("skips and notifies when the user navigated to a different node", () => {
    expect(
      resolveStreamDoneAction({
        lastViewNodeId: "node_B",
        sendingNodeId: "node_A",
        resultViewNodeId: "new_branch",
        isFollowing: true,
      }),
    ).toBe("skip-notify");
  });

  it("handles root scope (null) branching to a new node while scrolled away", () => {
    expect(
      resolveStreamDoneAction({
        lastViewNodeId: null,
        sendingNodeId: null,
        resultViewNodeId: "new_branch",
        isFollowing: false,
      }),
    ).toBe("stay-notify");
  });
});

// =============================================================================
// Integration scenario: full fork → continue flow
// =============================================================================

describe("fork-then-continue: ref synchronization", () => {
  /**
   * Simulates the full client-side flow:
   *
   *   handleFork  → sets lastViewNodeIdRef = scopeView, pendingForkScope = forkParent
   *   handleSend₁ → resolveSendContext(forkParent, scopeView) → syncs ref
   *   done₁       → guard passes → updateUrl(newBranch) → lastViewNodeIdRef = newBranch
   *   handleSend₂ → resolveSendContext(null, newBranch)  → linear, no forceBranch
   */
  it("maintains ref continuity across the full fork → send → done → send sequence", () => {
    // --- Step 1: handleFork sets refs ---
    let lastViewNodeId: string | null = "user_q2";  // set by handleFork → updateUrl
    const pendingForkScope: string | null = "user_q1"; // set by handleFork

    // --- Step 2: First message (forceBranch) ---
    const send1 = resolveSendContext(pendingForkScope, lastViewNodeId);
    lastViewNodeId = send1.nextLastViewNodeId; // apply ref update

    expect(send1.sendingNodeId).toBe("user_q1");
    expect(send1.forceBranch).toBe(true);
    expect(lastViewNodeId).toBe("user_q1"); // synced!

    // --- Step 3: Stream completes, done handler guard ---
    const guardPasses = shouldApplyStreamResult(lastViewNodeId, send1.sendingNodeId);
    expect(guardPasses).toBe(true); // ✓ guard passes → result applied

    // Simulate done handler: updateUrl sets lastViewNodeId to new branch
    lastViewNodeId = "c_new"; // server returned viewNodeId for the new branch

    // --- Step 4: Second message (normal, no fork) ---
    const send2 = resolveSendContext(null, lastViewNodeId);

    expect(send2.sendingNodeId).toBe("c_new");
    expect(send2.forceBranch).toBe(false);
    expect(send2.nextLastViewNodeId).toBe("c_new");

    // Guard would pass for the second message too
    expect(shouldApplyStreamResult(send2.nextLastViewNodeId, send2.sendingNodeId)).toBe(true);
  });

  it("WITHOUT the fix: guard would fail and view would be stuck (regression baseline)", () => {
    // Simulates the OLD behavior where lastViewNodeId was NOT synced.
    const lastViewNodeId: string | null = "user_q2"; // set by handleFork
    const pendingForkScope: string | null = "user_q1";

    // Old logic: sendingNodeId = forkScope, but lastViewNodeId unchanged
    const sendingNodeId = pendingForkScope ?? lastViewNodeId;
    // const lastViewNodeId stays "user_q2" (the bug — no sync)

    // Done handler guard: "user_q2" === "user_q1" → false!
    const guardPasses = shouldApplyStreamResult(lastViewNodeId, sendingNodeId);
    expect(guardPasses).toBe(false); // ← This was the bug

    // NEW logic: resolveSendContext syncs the ref
    const fixed = resolveSendContext(pendingForkScope, "user_q2");
    const fixedGuard = shouldApplyStreamResult(fixed.nextLastViewNodeId, fixed.sendingNodeId);
    expect(fixedGuard).toBe(true); // ← Fixed
  });
});
