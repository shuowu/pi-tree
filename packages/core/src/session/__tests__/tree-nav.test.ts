import { describe, it, expect } from "vitest";
import type { TreeNodeView } from "../../types/index.js";
import {
  isAINode,
  findNode,
  findParent,
  findBranchPoint,
  findForkPoint,
  findDeepestLeaf,
  findCurrentNode,
  isDescendantOf,
  findPlaceholderChild,
  needsAutoBranch,
  collectScopeMessages,
  buildBreadcrumb,
  type ContentMap,
} from "../tree-nav";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

/** Shorthand to build a TreeNodeView */
function node(
  id: string,
  label: string,
  children: TreeNodeView[] = [],
): TreeNodeView {
  return {
    id,
    parentId: null,
    label,
    status: "completed",
    messageCount: children.length,
    children,
    isCurrent: false,
  };
}

function userNode(id: string, label: string, children: TreeNodeView[] = []) {
  return node(id, label, children);
}

function aiNode(id: string, label: string, children: TreeNodeView[] = []) {
  return node(id, `✦ ${label}`, children);
}

/**
 * Build a content map from an array of [id, role, content] tuples.
 */
function buildContentMap(
  entries: Array<[string, string, string]>,
): ContentMap {
  const map: ContentMap = new Map();
  for (const [id, role, content] of entries) {
    map.set(id, { role, content, timestamp: "2026-01-01T00:00:00Z" });
  }
  return map;
}

// ─── Test Tree ─────────────────────────────────────────────────────────────────
//
//   root
//     └── user_1 ("Start reading")
//          └── ✦ AI_1 ("Chapter briefing")
//               ├── user_2a ("朱元璋") → ✦ AI_2a ("Part 1 briefing")
//               └── user_2b ("鄱阳湖")  → ✦ AI_2b ("Battle of Poyang") [leaf]
//
const testTree = node("root", "Book", [
  userNode("user_1", "Start reading", [
    aiNode("AI_1", "Chapter briefing", [
      userNode("user_2a", "朱元璋", [
        aiNode("AI_2a", "Part 1 briefing"),
      ]),
      userNode("user_2b", "鄱阳湖", [
        aiNode("AI_2b", "Battle of Poyang"),
      ]),
    ]),
  ]),
]);

const testContentMap = buildContentMap([
  ["root", "user", ""],
  ["user_1", "user", "Start reading this book"],
  ["AI_1", "assistant", "Here is your chapter briefing..."],
  ["user_2a", "user", "朱元璋"],
  ["AI_2a", "assistant", "Part 1: From monk to emperor..."],
  ["user_2b", "user", "鄱阳湖"],
  ["AI_2b", "assistant", "The Battle of Poyang Lake..."],
]);

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("isAINode", () => {
  it("returns true for AI nodes", () => {
    expect(isAINode(aiNode("x", "test"))).toBe(true);
  });

  it("returns false for user nodes", () => {
    expect(isAINode(userNode("x", "test"))).toBe(false);
  });
});

describe("findNode", () => {
  it("finds root", () => {
    expect(findNode(testTree, "root")?.id).toBe("root");
  });

  it("finds deeply nested node", () => {
    expect(findNode(testTree, "AI_2b")?.id).toBe("AI_2b");
  });

  it("returns null for missing node", () => {
    expect(findNode(testTree, "nonexistent")).toBeNull();
  });
});

describe("findParent", () => {
  it("finds parent of user node", () => {
    expect(findParent(testTree, "user_1")?.id).toBe("root");
  });

  it("finds parent of AI node", () => {
    expect(findParent(testTree, "AI_1")?.id).toBe("user_1");
  });

  it("finds parent of branched node", () => {
    expect(findParent(testTree, "user_2b")?.id).toBe("AI_1");
  });

  it("returns null for root", () => {
    expect(findParent(testTree, "root")).toBeNull();
  });
});

describe("findBranchPoint", () => {
  it("returns AI node when viewing its parent user node", () => {
    expect(findBranchPoint(testTree, "user_1")).toBe("AI_1");
  });

  it("returns AI node when viewing the AI node itself", () => {
    expect(findBranchPoint(testTree, "AI_1")).toBe("AI_1");
  });

  it("returns child AI when viewing a child user scope", () => {
    expect(findBranchPoint(testTree, "user_2a")).toBe("AI_2a");
  });

  it("returns leaf AI when viewing a leaf AI scope", () => {
    expect(findBranchPoint(testTree, "AI_2b")).toBe("AI_2b");
  });

  it("returns null for missing node", () => {
    expect(findBranchPoint(testTree, "nonexistent")).toBeNull();
  });

  it("finds AI through root → user chain", () => {
    // Root has one child (user_1), which has one child (AI_1)
    expect(findBranchPoint(testTree, "root")).toBe("AI_1");
  });

  describe("critical: does NOT walk past the first AI node", () => {
    it("after one branch: still returns AI_1, not the new branch's leaf", () => {
      // Simulate: user sent msg from user_1 scope, creating user_3 under AI_1.
      // AI_1 now has 3 children. findBranchPoint should still return AI_1.
      const treeAfterBranch = node("root", "Book", [
        userNode("user_1", "Start reading", [
          aiNode("AI_1", "Chapter briefing", [
            userNode("user_2a", "朱元璋", [
              aiNode("AI_2a", "Part 1 briefing"),
            ]),
            userNode("user_2b", "鄱阳湖", [
              aiNode("AI_2b", "Battle of Poyang"),
            ]),
            userNode("user_3", "New branch", [
              aiNode("AI_3", "New response"),
            ]),
          ]),
        ]),
      ]);

      expect(findBranchPoint(treeAfterBranch, "user_1")).toBe("AI_1");
    });

    it("after one branch from leaf: still returns AI, not deeper leaf", () => {
      // AI_2b was a leaf. User branched from user_2b scope.
      // AI_2b now has a child. findBranchPoint(user_2b) should still be AI_2b.
      const treeAfterLeafBranch = node("root", "Book", [
        userNode("user_1", "Start reading", [
          aiNode("AI_1", "Chapter briefing", [
            userNode("user_2b", "鄱阳湖", [
              aiNode("AI_2b", "Battle of Poyang", [
                userNode("user_3", "Tell me more", [
                  aiNode("AI_3", "Here's more detail..."),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]);

      // From user_2b scope, should branch from AI_2b (its direct AI child),
      // NOT from AI_3 (which is deeper)
      expect(findBranchPoint(treeAfterLeafBranch, "user_2b")).toBe("AI_2b");
    });
  });

  it("returns user node itself when it has no AI child (no response yet)", () => {
    const treeNoResponse = node("root", "Book", [
      userNode("user_1", "Start reading"),
    ]);
    expect(findBranchPoint(treeNoResponse, "user_1")).toBe("user_1");
  });

  describe("deeper levels: child scope branching", () => {
    // Simulate a 3-level deep tree:
    //
    //   root → user_1 → ✦ AI_1
    //                      ├── user_2a ("朱元璋") → ✦ AI_2a
    //                      │                         ├── user_3a ("童年") → ✦ AI_3a
    //                      │                         └── user_3b ("起义") → ✦ AI_3b
    //                      └── user_2b ("鄱阳湖") → ✦ AI_2b
    //
    const deepTree = node("root", "Book", [
      userNode("user_1", "Start reading", [
        aiNode("AI_1", "Chapter briefing", [
          userNode("user_2a", "朱元璋", [
            aiNode("AI_2a", "Part 1 briefing", [
              userNode("user_3a", "童年", [
                aiNode("AI_3a", "Childhood story"),
              ]),
              userNode("user_3b", "起义", [
                aiNode("AI_3b", "Rebellion story"),
              ]),
            ]),
          ]),
          userNode("user_2b", "鄱阳湖", [
            aiNode("AI_2b", "Battle of Poyang"),
          ]),
        ]),
      ]),
    ]);

    it("branches from child AI node when viewing child user scope", () => {
      // Viewing user_2a → should branch from AI_2a (its direct AI child)
      expect(findBranchPoint(deepTree, "user_2a")).toBe("AI_2a");
    });

    it("branches from child AI node when viewing the AI node itself", () => {
      expect(findBranchPoint(deepTree, "AI_2a")).toBe("AI_2a");
    });

    it("branches from grandchild AI when viewing grandchild scope", () => {
      // Viewing user_3a → should branch from AI_3a
      expect(findBranchPoint(deepTree, "user_3a")).toBe("AI_3a");
    });

    it("top-level scope still returns AI_1 despite deep descendants", () => {
      // user_1 → AI_1 has 2 children (fork). findBranchPoint should return AI_1.
      expect(findBranchPoint(deepTree, "user_1")).toBe("AI_1");
    });

    it("adding a third branch at child level: branch point stays at AI_2a", () => {
      // Simulate: user sent a 3rd message from user_2a scope.
      // AI_2a now has 3 children.
      const treeWith3rdChild = node("root", "Book", [
        userNode("user_1", "Start reading", [
          aiNode("AI_1", "Chapter briefing", [
            userNode("user_2a", "朱元璋", [
              aiNode("AI_2a", "Part 1 briefing", [
                userNode("user_3a", "童年", [
                  aiNode("AI_3a", "Childhood story"),
                ]),
                userNode("user_3b", "起义", [
                  aiNode("AI_3b", "Rebellion story"),
                ]),
                userNode("user_3c", "新问题", [
                  aiNode("AI_3c", "New answer"),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]);

      expect(findBranchPoint(treeWith3rdChild, "user_2a")).toBe("AI_2a");
    });

    it("branch from leaf grandchild still stays at that leaf's AI", () => {
      // user_3a → AI_3a is a leaf. Now user sends msg from user_3a scope.
      // AI_3a gets a child. Next msg from same scope should still find AI_3a.
      const treeAfterGrandchildBranch = node("root", "Book", [
        userNode("user_1", "Start reading", [
          aiNode("AI_1", "Chapter briefing", [
            userNode("user_2a", "朱元璋", [
              aiNode("AI_2a", "Part 1 briefing", [
                userNode("user_3a", "童年", [
                  aiNode("AI_3a", "Childhood story", [
                    userNode("user_4a", "More detail", [
                      aiNode("AI_4a", "Detail response"),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]);

      // From user_3a scope, branch point is AI_3a (not AI_4a)
      expect(findBranchPoint(treeAfterGrandchildBranch, "user_3a")).toBe("AI_3a");
    });
  });
});

// ─── findForkPoint ──────────────────────────────────────────────────────────────

describe("findForkPoint", () => {
  it("returns { forkId: AI_node, scopeId: parent_user_node } for AI node input", () => {
    // Clicking ⑂ on AI_2a:
    //   AI_2a → parent = user_2a → parent = AI_1 (grandparent AI)
    //   forkId = AI_1, scopeId = user_2a
    const result = findForkPoint(testTree, "AI_2a");
    expect(result).toEqual({ forkId: "AI_1", scopeId: "user_2a" });
  });

  it("returns { forkId: AI_child, scopeId: user_node } for user node input", () => {
    // Clicking ⑂ on user_2a:
    //   user_2a → parent = AI_1 → isAINode? yes → grandparent AI found
    //   But wait — user_2a is the clicked node, parent is AI_1.
    //   grandparent of user_2a = parent(AI_1) = user_1.
    //   user_1 is NOT an AI node, so falls through to the fallback.
    //   forkId = user_2a (the node itself), scopeId = AI_1 (parentUser)
    const result = findForkPoint(testTree, "user_2a");
    expect(result).toEqual({ forkId: "user_2a", scopeId: "AI_1" });
  });

  it("returns { forkId: AI_1, scopeId: user_1 } for mid-level AI node", () => {
    // Clicking ⑂ on AI_1:
    //   AI_1 → parent = user_1 → grandparent = root
    //   root is NOT an AI node → fallback
    //   forkId = AI_1, scopeId = user_1
    const result = findForkPoint(testTree, "AI_1");
    expect(result).toEqual({ forkId: "AI_1", scopeId: "user_1" });
  });

  it("returns null for non-existent node", () => {
    expect(findForkPoint(testTree, "nonexistent")).toBeNull();
  });

  it("returns { forkId: root, scopeId: null } for root node (no parent)", () => {
    const result = findForkPoint(testTree, "root");
    expect(result).toEqual({ forkId: "root", scopeId: null });
  });

  it("returns correct fork for a deep tree (grandparent IS an AI node)", () => {
    // Deep tree where grandparent of AI_3a IS an AI node (AI_2a).
    //   AI_3a → parent = user_3a → grandparent = AI_2a (isAINode ✓)
    //   forkId = AI_2a, scopeId = user_3a
    const deepTree = node("root", "Book", [
      userNode("user_1", "Start reading", [
        aiNode("AI_1", "Chapter briefing", [
          userNode("user_2a", "朱元璋", [
            aiNode("AI_2a", "Part 1 briefing", [
              userNode("user_3a", "童年", [
                aiNode("AI_3a", "Childhood story"),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);

    const result = findForkPoint(deepTree, "AI_3a");
    expect(result).toEqual({ forkId: "AI_2a", scopeId: "user_3a" });
  });

  it("returns fallback for leaf user node with no AI child", () => {
    const treeNoResp = node("root", "Book", [
      userNode("user_1", "Start reading"),
    ]);
    // user_1 → parent = root, grandparent = null (root has no parent)
    // root is not AI → fallback: forkId = user_1, scopeId = root
    const result = findForkPoint(treeNoResp, "user_1");
    expect(result).toEqual({ forkId: "user_1", scopeId: "root" });
  });
});

describe("collectScopeMessages — deeper levels", () => {
  const deepTree = node("root", "Book", [
    userNode("user_1", "Start reading", [
      aiNode("AI_1", "Chapter briefing", [
        userNode("user_2a", "朱元璋", [
          aiNode("AI_2a", "Part 1 briefing", [
            userNode("user_3a", "童年", [
              aiNode("AI_3a", "Childhood story"),
            ]),
            userNode("user_3b", "起义", [
              aiNode("AI_3b", "Rebellion story"),
            ]),
          ]),
        ]),
        userNode("user_2b", "鄱阳湖", [
          aiNode("AI_2b", "Battle of Poyang"),
        ]),
      ]),
    ]),
  ]);

  const deepContentMap = buildContentMap([
    ["root", "user", ""],
    ["user_1", "user", "Start reading"],
    ["AI_1", "assistant", "Chapter briefing content"],
    ["user_2a", "user", "朱元璋"],
    ["AI_2a", "assistant", "Part 1 briefing content"],
    ["user_2b", "user", "鄱阳湖"],
    ["AI_2b", "assistant", "Battle of Poyang content"],
    ["user_3a", "user", "童年"],
    ["AI_3a", "assistant", "Childhood story content"],
    ["user_3b", "user", "起义"],
    ["AI_3b", "assistant", "Rebellion story content"],
  ]);

  it("child scope includes fork parent context and branches", () => {
    const { messages, branches } = collectScopeMessages(
      deepTree,
      "user_2a",
      deepContentMap,
    );

    // user_1 → AI_1 (fork parent) + user_2a → AI_2a → fork
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ id: "user_1", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_1", role: "assistant" });
    expect(messages[2]).toMatchObject({ id: "user_2a", role: "user" });
    expect(messages[3]).toMatchObject({ id: "AI_2a", role: "assistant" });
    expect(branches).toHaveLength(2);
    expect(branches[0].nodeId).toBe("user_3a");
    expect(branches[1].nodeId).toBe("user_3b");
  });

  it("viewing child AI node includes its parent user msg", () => {
    const { messages, branches } = collectScopeMessages(
      deepTree,
      "AI_2a",
      deepContentMap,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_2a", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_2a", role: "assistant" });
    expect(branches).toHaveLength(2);
  });

  it("grandchild scope includes fork parent context", () => {
    const { messages, branches } = collectScopeMessages(
      deepTree,
      "user_3a",
      deepContentMap,
    );

    // user_2a → AI_2a (fork parent) + user_3a → AI_3a
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ id: "user_2a", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_2a", role: "assistant" });
    expect(messages[2]).toMatchObject({ id: "user_3a", role: "user" });
    expect(messages[3]).toMatchObject({ id: "AI_3a", role: "assistant" });
    expect(branches).toHaveLength(0);
  });

  it("viewing grandchild AI node includes parent user msg", () => {
    const { messages } = collectScopeMessages(
      deepTree,
      "AI_3a",
      deepContentMap,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_3a", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_3a", role: "assistant" });
  });

  it("top-level scope stops at first fork (does not show child content)", () => {
    const { messages, branches } = collectScopeMessages(
      deepTree,
      "user_1",
      deepContentMap,
    );

    // user_1 → AI_1 → fork (user_2a, user_2b)
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_1" });
    expect(messages[1]).toMatchObject({ id: "AI_1" });
    expect(branches).toHaveLength(2);
    // Should NOT include user_2a, AI_2a, etc.
  });
});


describe("collectScopeMessages", () => {
  it("collects user→AI pair from a user node", () => {
    const { messages, branches } = collectScopeMessages(
      testTree,
      "user_1",
      testContentMap,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_1", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_1", role: "assistant" });

    // AI_1 has 2 children → 2 branches
    expect(branches).toHaveLength(2);
    expect(branches[0].nodeId).toBe("user_2a");
    expect(branches[1].nodeId).toBe("user_2b");
  });

  it("includes parent user msg when viewing an AI node", () => {
    const { messages, branches } = collectScopeMessages(
      testTree,
      "AI_1",
      testContentMap,
    );

    // Should include user_1 (parent) + AI_1
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_1", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_1", role: "assistant" });
    expect(branches).toHaveLength(2);
  });

  it("collects chain for a child scope (with fork parent context)", () => {
    const { messages, branches } = collectScopeMessages(
      testTree,
      "user_2b",
      testContentMap,
    );

    // user_1 → AI_1 (fork parent) + user_2b → AI_2b
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ id: "user_1", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_1", role: "assistant" });
    expect(messages[2]).toMatchObject({ id: "user_2b", role: "user" });
    expect(messages[3]).toMatchObject({ id: "AI_2b", role: "assistant" });
    expect(branches).toHaveLength(0); // leaf
  });

  it("includes parent user msg when viewing a leaf AI node", () => {
    const { messages } = collectScopeMessages(
      testTree,
      "AI_2b",
      testContentMap,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_2b", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_2b", role: "assistant" });
  });

  it("handles null viewNodeId (root scope)", () => {
    const { messages } = collectScopeMessages(testTree, null, testContentMap);
    // Root → user_1 → AI_1 → fork
    // Root itself has empty content, so skip. user_1 and AI_1 shown.
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty for missing node", () => {
    const { messages, branches } = collectScopeMessages(
      testTree,
      "nonexistent",
      testContentMap,
    );
    expect(messages).toHaveLength(0);
    expect(branches).toHaveLength(0);
  });
});

describe("buildBreadcrumb", () => {
  it("builds path from root to target", () => {
    const crumbs = buildBreadcrumb(testTree, "AI_2a");
    const ids = crumbs.map((c) => c.nodeId);
    expect(ids).toEqual(["root", "user_1", "AI_1", "user_2a", "AI_2a"]);
  });

  it("returns single item for root", () => {
    const crumbs = buildBreadcrumb(testTree, "root");
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].nodeId).toBe("root");
  });

  it("returns empty for missing node", () => {
    const crumbs = buildBreadcrumb(testTree, "nonexistent");
    expect(crumbs).toHaveLength(0);
  });
});

// ─── Helpers for isCurrent tests ────────────────────────────────────────────────

function currentNode(
  id: string,
  label: string,
  children: TreeNodeView[] = [],
): TreeNodeView {
  return { ...node(id, label, children), isCurrent: true };
}

function currentAiNode(
  id: string,
  label: string,
  children: TreeNodeView[] = [],
): TreeNodeView {
  return { ...aiNode(id, label, children), isCurrent: true };
}

// ─── findCurrentNode ────────────────────────────────────────────────────────────

describe("findCurrentNode", () => {
  it("returns the node with isCurrent: true", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        currentAiNode("a1", "response"),
      ]),
    ]);
    expect(findCurrentNode(tree)?.id).toBe("a1");
  });

  it("returns root if root is current", () => {
    const tree = currentNode("root", "Book");
    expect(findCurrentNode(tree)?.id).toBe("root");
  });

  it("returns null if no node is current", () => {
    expect(findCurrentNode(testTree)).toBeNull();
  });

  it("finds deeply nested current node", () => {
    const tree = node("root", "Book", [
      userNode("u1", "q1", [
        aiNode("a1", "r1", [
          userNode("u2", "q2", [
            currentAiNode("a2", "r2"),
          ]),
        ]),
      ]),
    ]);
    expect(findCurrentNode(tree)?.id).toBe("a2");
  });

  it("returns deepest current node when entire path is marked current (PiSession behavior)", () => {
    // PiSession sets isCurrent on ALL nodes from root to leaf via isOnCurrentPath.
    // findCurrentNode must return the deepest (the actual leaf), not the root.
    const tree: TreeNodeView = {
      ...node("root", "Book"),
      isCurrent: true,
      children: [{
        ...userNode("u1", "q1"),
        isCurrent: true,
        children: [{
          ...aiNode("a1", "r1"),
          isCurrent: true,
          children: [{
            ...userNode("u2", "q2"),
            isCurrent: true,
            children: [{
              ...aiNode("a2", "leaf response"),
              isCurrent: true,
            }],
          }],
        }],
      }],
    };
    expect(findCurrentNode(tree)?.id).toBe("a2");
  });

  it("returns deepest current on correct branch when tree has forks", () => {
    // Fork: root → u1 → a1 has two children (u2, u3).
    // Only u3 branch has isCurrent path.
    const tree: TreeNodeView = {
      ...node("root", "Book"),
      isCurrent: true,
      children: [{
        ...userNode("u1", "q1"),
        isCurrent: true,
        children: [{
          ...aiNode("a1", "r1"),
          isCurrent: true,
          children: [
            userNode("u2", "original branch", [aiNode("a2", "orig response")]),
            {
              ...userNode("u3", "forked branch"),
              isCurrent: true,
              children: [{
                ...aiNode("a3", "fork response"),
                isCurrent: true,
              }],
            },
          ],
        }],
      }],
    };
    expect(findCurrentNode(tree)?.id).toBe("a3");
  });
});

// ─── isDescendantOf ─────────────────────────────────────────────────────────────

describe("isDescendantOf", () => {
  it("returns true when nodeId equals ancestorId", () => {
    expect(isDescendantOf(testTree, "AI_1", "AI_1")).toBe(true);
  });

  it("returns true for direct child", () => {
    expect(isDescendantOf(testTree, "user_2a", "AI_1")).toBe(true);
  });

  it("returns true for deep descendant", () => {
    expect(isDescendantOf(testTree, "AI_2a", "AI_1")).toBe(true);
  });

  it("returns false for sibling", () => {
    expect(isDescendantOf(testTree, "user_2a", "user_2b")).toBe(false);
  });

  it("returns false for ancestor (reverse direction)", () => {
    expect(isDescendantOf(testTree, "AI_1", "AI_2a")).toBe(false);
  });

  it("returns false for non-existent ancestorId", () => {
    expect(isDescendantOf(testTree, "AI_1", "nonexistent")).toBe(false);
  });

  it("returns false for non-existent nodeId", () => {
    expect(isDescendantOf(testTree, "nonexistent", "AI_1")).toBe(false);
  });

  it("returns true for root as ancestor of anything", () => {
    expect(isDescendantOf(testTree, "AI_2b", "root")).toBe(true);
  });
});

// ─── findPlaceholderChild ───────────────────────────────────────────────────────

describe("findPlaceholderChild", () => {
  function placeholderNode(
    id: string,
    label = "New branch",
  ): TreeNodeView {
    return {
      id,
      parentId: null,
      label,
      status: "placeholder",
      messageCount: 0,
      children: [],
      isCurrent: false,
    };
  }

  it("returns the placeholder node", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a"),
          placeholderNode("ph_1"),
        ]),
      ]),
    ]);

    const ph = findPlaceholderChild(tree, "AI_1");
    expect(ph).not.toBeNull();
    expect(ph!.id).toBe("ph_1");
    expect(ph!.status).toBe("placeholder");
  });

  it("returns null when no placeholder exists", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a"),
        ]),
      ]),
    ]);

    expect(findPlaceholderChild(tree, "AI_1")).toBeNull();
  });
});

// ─── collectScopeMessages — placeholder behavior ────────────────────────────────

describe("collectScopeMessages — placeholder behavior", () => {
  function placeholderNode(
    id: string,
    label = "New branch",
  ): TreeNodeView {
    return {
      id,
      parentId: null,
      label,
      status: "placeholder",
      messageCount: 0,
      children: [],
      isCurrent: false,
    };
  }

  it("reports all children including placeholders as branch cards", () => {
    // AI_1 has 2 real children + 1 unused placeholder — all 3 reported
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a"),
          userNode("u2b", "branch b"),
          placeholderNode("ph_1"),
        ]),
      ]),
    ]);

    const contentMap = buildContentMap([
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
      ["u2a", "user", "branch a"],
      ["u2b", "user", "branch b"],
    ]);

    const { branches } = collectScopeMessages(tree, "u1", contentMap);
    expect(branches.length).toBe(3);
    expect(branches.map(b => b.nodeId)).toEqual(["u2a", "u2b", "ph_1"]);
  });

  it("reports fork when placeholder has a real sibling (⑂ just clicked)", () => {
    // AI_1 has 1 real child + 1 placeholder — both reported as branch cards
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2", "continuation", [
            aiNode("AI_2", "resp 2"),
          ]),
          placeholderNode("ph_1"),
        ]),
      ]),
    ]);

    const contentMap = buildContentMap([
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
      ["u2", "user", "continuation"],
      ["AI_2", "assistant", "resp 2"],
    ]);

    const { messages, branches } = collectScopeMessages(tree, "u1", contentMap);
    // Stops at fork — both children reported
    expect(messages.length).toBe(2); // u1, AI_1
    expect(branches.length).toBe(2);
    expect(branches.map(b => b.nodeId)).toEqual(["u2", "ph_1"]);
  });

  it("shows consumed placeholder (with children) as a branch card", () => {
    // After forceBranch into a placeholder, the placeholder has children.
    // It should appear as a branch card alongside the original branch.
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "original branch", [
            aiNode("AI_2a", "resp a"),
          ]),
          // Consumed placeholder — has children from forceBranch
          {
            id: "ph_1",
            parentId: null,
            label: "New branch",
            status: "placeholder" as const,
            messageCount: 2,
            isCurrent: false,
            children: [
              userNode("u_fork", "forked message", [
                aiNode("AI_fork", "fork resp"),
              ]),
            ],
          },
        ]),
      ]),
    ]);

    const contentMap = buildContentMap([
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
      ["u2a", "user", "original branch"],
      ["u_fork", "user", "forked message"],
    ]);

    const { branches } = collectScopeMessages(tree, "u1", contentMap);
    // Both branches visible — original + consumed placeholder
    expect(branches.length).toBe(2);
    expect(branches.map(b => b.nodeId).sort()).toEqual(["ph_1", "u2a"]);
  });
});

// ── parentContext (ancestor chain) ─────────────────────────────────────────

describe("collectScopeMessages — parentContext", () => {
  it("returns empty parentContext at root scope", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello", [aiNode("AI_1", "hi")]),
    ]);
    const contentMap = buildContentMap([
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
    ]);

    const { parentContext } = collectScopeMessages(tree, null, contentMap);
    expect(parentContext).toEqual([]);
  });

  it("returns empty parentContext when viewing root node", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello", [aiNode("AI_1", "hi")]),
    ]);
    const contentMap = buildContentMap([
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
    ]);

    const { parentContext } = collectScopeMessages(tree, "u1", contentMap);
    // u1 is the first real node — root is the only ancestor, but root
    // has no content in contentMap → parentContext stays empty.
    expect(parentContext).toEqual([]);
  });

  it("collects ancestor chain for a deep node", () => {
    // root → u1 → AI_1 → u2 → AI_2 → u3 → AI_3
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2", "continue", [
            aiNode("AI_2", "ok", [
              userNode("u3", "deeper", [
                aiNode("AI_3", "deep response"),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const contentMap = buildContentMap([
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
      ["u2", "user", "continue"],
      ["AI_2", "assistant", "ok"],
      ["u3", "user", "deeper"],
      ["AI_3", "assistant", "deep response"],
    ]);

    // View at u3 — messages include u3, AI_3.
    // parentContext = all ancestors NOT in messages.
    const { messages, parentContext } = collectScopeMessages(tree, "u3", contentMap);
    expect(messages.map(m => m.id)).toEqual(["u3", "AI_3"]);
    // Ancestors: root (no content), u1, AI_1, u2, AI_2
    expect(parentContext.map(m => m.id)).toEqual(["u1", "AI_1", "u2", "AI_2"]);
  });

  it("excludes fork-parent prepended messages from parentContext", () => {
    // root → u1 → AI_1 (fork) → [u2a (branch a), u2b (branch b)]
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a", [aiNode("AI_2a", "resp a")]),
          userNode("u2b", "branch b", [aiNode("AI_2b", "resp b")]),
        ]),
      ]),
    ]);
    const contentMap = buildContentMap([
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
      ["u2a", "user", "branch a"],
      ["AI_2a", "assistant", "resp a"],
      ["u2b", "user", "branch b"],
      ["AI_2b", "assistant", "resp b"],
    ]);

    // View branch b at u2b:
    // - Fork prepend adds u1 (grandparent user) + AI_1 (parent AI)
    // - walkChain adds u2b, AI_2b
    // - So messages = [u1, AI_1, u2b, AI_2b]
    const { messages, parentContext } = collectScopeMessages(tree, "u2b", contentMap);
    expect(messages.map(m => m.id)).toEqual(["u1", "AI_1", "u2b", "AI_2b"]);
    // parentContext should NOT duplicate u1, AI_1 — they're already in messages.
    // root has no content → parentContext is empty.
    expect(parentContext).toEqual([]);
  });

  it("parentContext includes nodes above fork-parent prepend", () => {
    // root → u0 → AI_0 → u1 → AI_1 (fork) → [u2a, u2b]
    const tree = node("root", "Book", [
      userNode("u0", "start", [
        aiNode("AI_0", "welcome", [
          userNode("u1", "hello", [
            aiNode("AI_1", "hi", [
              userNode("u2a", "branch a"),
              userNode("u2b", "branch b"),
            ]),
          ]),
        ]),
      ]),
    ]);
    const contentMap = buildContentMap([
      ["u0", "user", "start"],
      ["AI_0", "assistant", "welcome"],
      ["u1", "user", "hello"],
      ["AI_1", "assistant", "hi"],
      ["u2a", "user", "branch a"],
      ["u2b", "user", "branch b"],
    ]);

    // View u2b:
    // - Fork prepend adds u1, AI_1
    // - walkChain adds u2b
    // - messages = [u1, AI_1, u2b]
    const { messages, parentContext } = collectScopeMessages(tree, "u2b", contentMap);
    expect(messages.map(m => m.id)).toEqual(["u1", "AI_1", "u2b"]);
    // Ancestors above the fork: u0, AI_0
    expect(parentContext.map(m => m.id)).toEqual(["u0", "AI_0"]);
  });
});

// ── findDeepestLeaf ────────────────────────────────────────────────────────────

describe("findDeepestLeaf", () => {
  it("follows a linear chain to the deepest node", () => {
    // u1 → AI_1 → u2 → AI_2
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2", "continue", [
            aiNode("AI_2", "ok"),
          ]),
        ]),
      ]),
    ]);

    expect(findDeepestLeaf(tree, "u1")).toBe("AI_2");
  });

  it("follows first child at forks", () => {
    // AI_1 has 2 children — follows first (u2a → AI_2a)
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a", [
            aiNode("AI_2a", "resp a"),
          ]),
          userNode("u2b", "branch b"),
        ]),
      ]),
    ]);

    expect(findDeepestLeaf(tree, "u1")).toBe("AI_2a");
  });

  it("returns the node itself when it is already a leaf", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "leaf node"),
      ]),
    ]);

    expect(findDeepestLeaf(tree, "AI_1")).toBe("AI_1");
  });

  it("returns the viewNodeId when node is not found", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello"),
    ]);

    expect(findDeepestLeaf(tree, "nonexistent")).toBe("nonexistent");
  });

  it("walks from a mid-tree fork child to its deepest leaf", () => {
    // Scenario: user is viewing u2b which continues to u3 → AI_3
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a"),
          userNode("u2b", "branch b", [
            aiNode("AI_2b", "resp b", [
              userNode("u3", "deeper", [
                aiNode("AI_3", "deep resp"),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);

    // From u2b, the deepest leaf is AI_3
    expect(findDeepestLeaf(tree, "u2b")).toBe("AI_3");
  });

  it("follows placeholder as children[0] — latent invariant", () => {
    // branchAt always appends placeholders LAST, so children[0] is never a
    // placeholder in practice. This test documents that if a placeholder
    // were children[0], findDeepestLeaf would follow it (since it blindly
    // takes children[0]). This is safe because the invariant holds at
    // write time, but we record the behavior here for visibility.
    const placeholderFirst: TreeNodeView = {
      id: "ph_1",
      parentId: null,
      label: "New branch",
      status: "placeholder",
      messageCount: 0,
      children: [],
      isCurrent: false,
    };

    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          placeholderFirst,                    // children[0] = placeholder
          userNode("u2", "real branch", [
            aiNode("AI_2", "resp"),
          ]),
        ]),
      ]),
    ]);

    // findDeepestLeaf follows children[0] which is the placeholder leaf
    expect(findDeepestLeaf(tree, "AI_1")).toBe("ph_1");
  });
});

// ─── needsAutoBranch ────────────────────────────────────────────────────────────

describe("needsAutoBranch", () => {
  it("returns { branchId: null } for a linear chain (no fork)", () => {
    // u1 → AI_1 → u2 → AI_2 (no fork anywhere)
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2", "continue", [
            aiNode("AI_2", "ok"),
          ]),
        ]),
      ]),
    ]);

    expect(needsAutoBranch(tree, "u1")).toEqual({ branchId: null });
  });

  it("returns the fork AI node when fork is at the first AI level", () => {
    // u1 → AI_1 has 2 children → fork at AI_1
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a"),
          userNode("u2b", "branch b"),
        ]),
      ]),
    ]);

    const result = needsAutoBranch(tree, "u1");
    expect(result.branchId).toBe("AI_1");
  });

  it("walks through single-child chain to find a deep fork", () => {
    // u1 → AI_1 → u2 → AI_2 (fork: 2 children)
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2", "continue", [
            aiNode("AI_2", "ok", [
              userNode("u3a", "branch a"),
              userNode("u3b", "branch b"),
            ]),
          ]),
        ]),
      ]),
    ]);

    const result = needsAutoBranch(tree, "u1");
    expect(result.branchId).toBe("AI_2");
  });

  it("returns placeholder ID when fork has an unused placeholder", () => {
    const placeholder: TreeNodeView = {
      id: "ph_1",
      parentId: null,
      label: "New branch",
      status: "placeholder",
      messageCount: 0,
      children: [],
      isCurrent: false,
    };

    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a"),
          placeholder,
        ]),
      ]),
    ]);

    const result = needsAutoBranch(tree, "u1");
    expect(result.branchId).toBe("AI_1");
    expect(result.placeholderId).toBe("ph_1");
  });

  it("returns { branchId: null } when AI node has no children", () => {
    // u1 → AI_1 (leaf, no children)
    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi"),
      ]),
    ]);

    expect(needsAutoBranch(tree, "u1")).toEqual({ branchId: null });
  });

  it("returns { branchId: null } for a non-existent view node", () => {
    const tree = node("root", "Book", [
      userNode("u1", "hello"),
    ]);

    expect(needsAutoBranch(tree, "nonexistent")).toEqual({ branchId: null });
  });

  it("does not return consumed placeholder", () => {
    // Consumed placeholder has children — findPlaceholderChild skips it
    const consumedPlaceholder: TreeNodeView = {
      id: "ph_1",
      parentId: null,
      label: "New branch",
      status: "placeholder",
      messageCount: 2,
      isCurrent: false,
      children: [
        userNode("u_fork", "forked", [aiNode("AI_fork", "resp")]),
      ],
    };

    const tree = node("root", "Book", [
      userNode("u1", "hello", [
        aiNode("AI_1", "hi", [
          userNode("u2a", "branch a"),
          consumedPlaceholder,
        ]),
      ]),
    ]);

    const result = needsAutoBranch(tree, "u1");
    expect(result.branchId).toBe("AI_1");
    expect(result.placeholderId).toBeUndefined();
  });
});
