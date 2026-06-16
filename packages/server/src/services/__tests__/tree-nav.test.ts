import { describe, it, expect } from "vitest";
import type { TreeNodeView } from "@pi-tree/core";
import {
  isAINode,
  findNode,
  findParent,
  findBranchPoint,
  collectScopeMessages,
  buildBreadcrumb,
  type ContentMap,
} from "@pi-tree/core";

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
