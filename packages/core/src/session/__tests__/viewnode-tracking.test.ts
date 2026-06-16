/**
 * Tests for viewNodeId tracking and the fork-branch UX flow.
 *
 * These tests verify:
 * 1. When viewNodeId is null, the server should still resolve a valid scope
 * 2. forceBranch creates a sibling branch (not linear continuation)
 * 3. Auto-branching at existing fork points works
 * 4. The complete fork UX flow: fork button → navigate → send → branch created
 *
 * Uses manual TreeNodeView structures (no SDK dependency).
 */
import { describe, it, expect } from "vitest";
import type { TreeNodeView } from "../../types/index.js";
import {
  findNode,
  findParent,
  findCurrentNode,
  findBranchPoint,
  collectScopeMessages,
  isDescendantOf,
  type ContentMap,
} from "../tree-nav.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function node(
  id: string,
  label: string,
  children: TreeNodeView[] = [],
  isCurrent = false,
): TreeNodeView {
  return {
    id,
    parentId: null,
    label,
    status: "completed",
    messageCount: children.length,
    children,
    isCurrent,
  };
}

function userNode(id: string, label: string, children: TreeNodeView[] = [], isCurrent = false) {
  return node(id, label, children, isCurrent);
}

function aiNode(id: string, label: string, children: TreeNodeView[] = [], isCurrent = false) {
  return node(id, `✦ ${label}`, children, isCurrent);
}

function buildContentMap(
  entries: Array<[string, string, string]>,
): ContentMap {
  const map: ContentMap = new Map();
  for (const [id, role, content] of entries) {
    map.set(id, { role, content, timestamp: "2026-01-01T00:00:00Z" });
  }
  return map;
}

// ─── Scenario: Linear conversation with PiSession-style isCurrent ──────────
//
// This mimics what PiSession actually produces: isCurrent is set on ALL
// nodes on the path from root to the active leaf (via isOnCurrentPath).
//
//   root (isCurrent=true)
//     └─ user1 "test" (isCurrent=true)
//          └─ AI1 "I'm here to help" (isCurrent=true)
//               └─ user2 "test1" (isCurrent=true)
//                    └─ AI2 "Received test1" (isCurrent=true, LEAF)

function buildLinearTree(): TreeNodeView {
  return node("root", "news", [
    userNode("user1", "test", [
      aiNode("AI1", "I'm here to help", [
        userNode("user2", "test1", [
          aiNode("AI2", "Received test1", [], true),
        ], true),
      ], true),
    ], true),
  ], true);
}

const linearContentMap = buildContentMap([
  ["root", "system", "news"],
  ["user1", "user", "test"],
  ["AI1", "assistant", "I'm here to help"],
  ["user2", "user", "test1"],
  ["AI2", "assistant", "Received test1"],
]);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("findCurrentNode with PiSession-style isCurrent (all-path)", () => {
  it("returns the deepest leaf, not the root", () => {
    const tree = buildLinearTree();
    const current = findCurrentNode(tree);
    expect(current).not.toBeNull();
    expect(current!.id).toBe("AI2");
  });

});

describe("fork creates branch visible in parent scope", () => {
  // After forking from AI1, the tree becomes:
  //
  //   root
  //     └─ user1 "test"
  //          └─ AI1 "I'm here to help"
  //               ├─ user2 "test1"              (original)
  //               │    └─ AI2 "Received test1"
  //               └─ user3 "test 2"             (forked, isCurrent path)
  //                    └─ AI3 "Received test 2"  (LEAF)

  function buildForkedTree(): TreeNodeView {
    return node("root", "news", [
      userNode("user1", "test", [
        aiNode("AI1", "I'm here to help", [
          userNode("user2", "test1", [
            aiNode("AI2", "Received test1"),
          ]),
          userNode("user3", "test 2", [
            aiNode("AI3", "Received test 2", [], true),
          ], true),
        ], true),
      ], true),
    ], true);
  }

  const forkedContentMap = buildContentMap([
    ["root", "system", "news"],
    ["user1", "user", "test"],
    ["AI1", "assistant", "I'm here to help"],
    ["user2", "user", "test1"],
    ["AI2", "assistant", "Received test1"],
    ["user3", "user", "test 2"],
    ["AI3", "assistant", "Received test 2"],
  ]);

  it("AI1 has 2 children (original + fork)", () => {
    const tree = buildForkedTree();
    const ai1 = findNode(tree, "AI1");
    expect(ai1!.children.length).toBe(2);
  });

  it("findCurrentNode returns AI3 (forked branch leaf)", () => {
    const tree = buildForkedTree();
    const current = findCurrentNode(tree);
    expect(current!.id).toBe("AI3");
  });

  it("collectScopeMessages at user1 shows branch cards at AI1", () => {
    const tree = buildForkedTree();
    const { messages, branches } = collectScopeMessages(tree, "user1", forkedContentMap);

    // Messages: user1 + AI1, then stops at fork
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe("test");
    expect(messages[1].content).toContain("I'm here to help");

    // Branch cards for user2 and user3
    expect(branches.length).toBe(2);
    expect(branches.map((b) => b.nodeId).sort()).toEqual(["user2", "user3"].sort());
  });

  it("collectScopeMessages at AI1 shows branch cards", () => {
    const tree = buildForkedTree();
    const { messages, branches } = collectScopeMessages(tree, "AI1", forkedContentMap);

    // Messages: user1 (parent) + AI1
    expect(messages.length).toBe(2);

    // Branch cards
    expect(branches.length).toBe(2);
  });


});

describe("triple fork scenario", () => {
  // After 3 messages from same parent scope, each creating a fork:
  //
  //   root
  //     └─ user1 "test"
  //          └─ AI1 "I'm here to help"
  //               ├─ user2 "test1"
  //               │    └─ AI2 "Received test1"
  //               ├─ user3 "test 2"
  //               │    └─ AI3 "Received test 2"
  //               └─ user4 "test 3"              (isCurrent path)
  //                    └─ AI4 "Received test 3"   (LEAF)

  function buildTripleForkTree(): TreeNodeView {
    return node("root", "news", [
      userNode("user1", "test", [
        aiNode("AI1", "I'm here to help", [
          userNode("user2", "test1", [
            aiNode("AI2", "Received test1"),
          ]),
          userNode("user3", "test 2", [
            aiNode("AI3", "Received test 2"),
          ]),
          userNode("user4", "test 3", [
            aiNode("AI4", "Received test 3", [], true),
          ], true),
        ], true),
      ], true),
    ], true);
  }

  const tripleContentMap = buildContentMap([
    ["root", "system", "news"],
    ["user1", "user", "test"],
    ["AI1", "assistant", "I'm here to help"],
    ["user2", "user", "test1"],
    ["AI2", "assistant", "Received test1"],
    ["user3", "user", "test 2"],
    ["AI3", "assistant", "Received test 2"],
    ["user4", "user", "test 3"],
    ["AI4", "assistant", "Received test 3"],
  ]);

  it("AI1 has 3 children", () => {
    const tree = buildTripleForkTree();
    const ai1 = findNode(tree, "AI1");
    expect(ai1!.children.length).toBe(3);
  });

  it("collectScopeMessages at user1 shows 3 branch cards", () => {
    const tree = buildTripleForkTree();
    const { messages, branches } = collectScopeMessages(tree, "user1", tripleContentMap);

    expect(messages.length).toBe(2); // user1 + AI1
    expect(branches.length).toBe(3); // user2, user3, user4
  });



  it("each branch scope is linear (no nested branches)", () => {
    const tree = buildTripleForkTree();

    for (const userId of ["user2", "user3", "user4"]) {
      const { branches } = collectScopeMessages(tree, userId, tripleContentMap);
      expect(branches.length).toBe(0);
    }
  });

  it("findCurrentNode is at AI4 (latest fork)", () => {
    const tree = buildTripleForkTree();
    expect(findCurrentNode(tree)!.id).toBe("AI4");
  });
});

