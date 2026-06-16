/**
 * fork-branch.test.ts — Comprehensive tests for fork/branching behavior.
 *
 * Two sections:
 * 1. Unit tests — manual TreeNodeView structures, no SDK dependency
 * 2. Integration tests — real SessionManager.inMemory(), proves full flow
 */

import { describe, it, expect } from "vitest";
import type { TreeNodeView } from "../../types/index.js";
import {
  collectScopeMessages,
  findBranchPoint,
  type ContentMap,
} from "../tree-nav.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers (shared by unit tests)
// ═══════════════════════════════════════════════════════════════════════════

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

function buildContentMap(
  entries: Array<[string, string, string]>,
): ContentMap {
  const map: ContentMap = new Map();
  for (const [id, role, content] of entries) {
    map.set(id, { role, content, timestamp: "2026-01-01T00:00:00Z" });
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: Unit Tests — Manual TreeNodeView structures
// ═══════════════════════════════════════════════════════════════════════════
//
// Tree structure after fork from AI2:
//
//   root
//     └── user1 ("Hello")
//          └── ✦ AI1 ("Hi there")
//               └── user2 ("Tell me more")
//                    └── ✦ AI2 ("Here's more detail")
//                         ├── user3 ("Thanks")           ← original path
//                         │    └── ✦ AI3 ("You're welcome")
//                         └── user4 ("New branch question")  ← forked path
//                              └── ✦ AI4 ("New branch answer")
//

const forkedTree = node("root", "Session", [
  userNode("user1", "Hello", [
    aiNode("AI1", "Hi there", [
      userNode("user2", "Tell me more", [
        aiNode("AI2", "Here's more detail", [
          userNode("user3", "Thanks", [
            aiNode("AI3", "You're welcome"),
          ]),
          userNode("user4", "New branch question", [
            aiNode("AI4", "New branch answer"),
          ]),
        ]),
      ]),
    ]),
  ]),
]);

const forkedContentMap = buildContentMap([
  ["root", "user", ""],
  ["user1", "user", "Hello"],
  ["AI1", "assistant", "Hi there"],
  ["user2", "user", "Tell me more"],
  ["AI2", "assistant", "Here's more detail"],
  ["user3", "user", "Thanks"],
  ["AI3", "assistant", "You're welcome"],
  ["user4", "user", "New branch question"],
  ["AI4", "assistant", "New branch answer"],
]);

describe("Fork branching — unit tests (manual tree structures)", () => {
  describe("simpleBranch creates fork structure", () => {
    it("AI2 node has 2 children after fork", () => {
      const ai2 = forkedTree.children[0]   // user1
        .children[0]   // AI1
        .children[0]   // user2
        .children[0];  // AI2
      expect(ai2.children).toHaveLength(2);
    });

    it("original path (user3→AI3) is preserved", () => {
      const user3 = forkedTree.children[0].children[0].children[0].children[0].children[0];
      expect(user3.id).toBe("user3");
      expect(user3.label).toBe("Thanks");
      expect(user3.children).toHaveLength(1);
      expect(user3.children[0].id).toBe("AI3");
    });

    it("new branch path (user4→AI4) exists", () => {
      const user4 = forkedTree.children[0].children[0].children[0].children[0].children[1];
      expect(user4.id).toBe("user4");
      expect(user4.label).toBe("New branch question");
      expect(user4.children).toHaveLength(1);
      expect(user4.children[0].id).toBe("AI4");
    });
  });

  describe("collectScopeMessages returns branch cards at fork points", () => {
    it("viewing scope at AI2 → shows user2+AI2 pair and both branches as BranchOptions", () => {
      const { messages, branches } = collectScopeMessages(
        forkedTree,
        "AI2",
        forkedContentMap,
      );

      // AI2 is an AI node → should include parent user msg (user2)
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ id: "user2", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI2", role: "assistant" });

      // AI2 has 2 children → 2 branches
      expect(branches).toHaveLength(2);
      expect(branches[0].nodeId).toBe("user3");
      expect(branches[1].nodeId).toBe("user4");
    });

    it("viewing scope at user2 → walks to AI2, shows branches", () => {
      const { messages, branches } = collectScopeMessages(
        forkedTree,
        "user2",
        forkedContentMap,
      );

      // user2 → AI2 (linear walk) → fork
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ id: "user2", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI2", role: "assistant" });
      expect(branches).toHaveLength(2);
      expect(branches[0].nodeId).toBe("user3");
      expect(branches[1].nodeId).toBe("user4");
    });

    it("viewing scope at root (null) → walks chain, shows branches at AI2 fork point", () => {
      const { messages, branches } = collectScopeMessages(
        forkedTree,
        null,
        forkedContentMap,
      );

      // root (empty content, skipped) → user1 → AI1 → user2 → AI2 → fork
      // Root content is empty, so won't appear as a message
      // But the walkChain walks: root → user1 → AI1 → user2 → AI2 → fork
      expect(messages.length).toBeGreaterThanOrEqual(4); // user1, AI1, user2, AI2
      expect(branches).toHaveLength(2);
    });

    it("viewing scope at user1 → walks through AI1, user2, AI2, then shows branches", () => {
      const { messages, branches } = collectScopeMessages(
        forkedTree,
        "user1",
        forkedContentMap,
      );

      // user1 → AI1 → user2 → AI2 → fork
      expect(messages).toHaveLength(4);
      expect(messages[0]).toMatchObject({ id: "user1", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI1", role: "assistant" });
      expect(messages[2]).toMatchObject({ id: "user2", role: "user" });
      expect(messages[3]).toMatchObject({ id: "AI2", role: "assistant" });
      expect(branches).toHaveLength(2);
    });
  });

  describe("scope within a branch is linear", () => {
  it("viewing scope at user3 includes fork parent context", () => {
      const { messages, branches } = collectScopeMessages(
        forkedTree,
        "user3",
        forkedContentMap,
      );

      // user2 → AI2 (fork parent context) + user3 → AI3
      expect(messages).toHaveLength(4);
      expect(messages[0]).toMatchObject({ id: "user2", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI2", role: "assistant" });
      expect(messages[2]).toMatchObject({ id: "user3", role: "user" });
      expect(messages[3]).toMatchObject({ id: "AI3", role: "assistant" });
      expect(branches).toHaveLength(0);
    });

    it("viewing scope at user4 includes fork parent context", () => {
      const { messages, branches } = collectScopeMessages(
        forkedTree,
        "user4",
        forkedContentMap,
      );

      // user2 → AI2 (fork parent context) + user4 → AI4
      expect(messages).toHaveLength(4);
      expect(messages[0]).toMatchObject({ id: "user2", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI2", role: "assistant" });
      expect(messages[2]).toMatchObject({ id: "user4", role: "user" });
      expect(messages[3]).toMatchObject({ id: "AI4", role: "assistant" });
      expect(branches).toHaveLength(0);
    });
  });

  describe("findBranchPoint resolves correctly after fork", () => {
    it("findBranchPoint from user2 → AI2", () => {
      expect(findBranchPoint(forkedTree, "user2")).toBe("AI2");
    });

    it("findBranchPoint from AI2 → AI2", () => {
      expect(findBranchPoint(forkedTree, "AI2")).toBe("AI2");
    });

    it("findBranchPoint from user3 → AI3 (its own AI child)", () => {
      // user3 has one child AI3, which is an AI node → return AI3
      expect(findBranchPoint(forkedTree, "user3")).toBe("AI3");
    });

    it("findBranchPoint from user4 → AI4 (its own AI child)", () => {
      // user4 has one child AI4, which is an AI node → return AI4
      expect(findBranchPoint(forkedTree, "user4")).toBe("AI4");
    });

    it("findBranchPoint from user1 → AI1 (walks single-child chain)", () => {
      // user1 → AI1 (AI node found)
      expect(findBranchPoint(forkedTree, "user1")).toBe("AI1");
    });

    it("findBranchPoint from AI1 → AI1 (already an AI node)", () => {
      expect(findBranchPoint(forkedTree, "AI1")).toBe("AI1");
    });
  });

  describe("nested fork (fork within a branch)", () => {
    // After the first fork, fork again from AI3:
    //   AI3 now has 2 children: user5 (original continuation) and user6 (nested fork)
    const nestedForkTree = node("root", "Session", [
      userNode("user1", "Hello", [
        aiNode("AI1", "Hi there", [
          userNode("user2", "Tell me more", [
            aiNode("AI2", "Here's more detail", [
              userNode("user3", "Thanks", [
                aiNode("AI3", "You're welcome", [
                  userNode("user5", "Original continuation", [
                    aiNode("AI5", "Continued response"),
                  ]),
                  userNode("user6", "Nested fork question", [
                    aiNode("AI6", "Nested fork answer"),
                  ]),
                ]),
              ]),
              userNode("user4", "New branch question", [
                aiNode("AI4", "New branch answer"),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);

    const nestedContentMap = buildContentMap([
      ["root", "user", ""],
      ["user1", "user", "Hello"],
      ["AI1", "assistant", "Hi there"],
      ["user2", "user", "Tell me more"],
      ["AI2", "assistant", "Here's more detail"],
      ["user3", "user", "Thanks"],
      ["AI3", "assistant", "You're welcome"],
      ["user4", "user", "New branch question"],
      ["AI4", "assistant", "New branch answer"],
      ["user5", "user", "Original continuation"],
      ["AI5", "assistant", "Continued response"],
      ["user6", "user", "Nested fork question"],
      ["AI6", "assistant", "Nested fork answer"],
    ]);

    it("AI3 has 2 children after nested fork", () => {
      const ai3 = nestedForkTree
        .children[0].children[0].children[0].children[0]
        .children[0].children[0]; // AI3
      expect(ai3.id).toBe("AI3");
      expect(ai3.children).toHaveLength(2);
    });

    it("collectScopeMessages at AI3 → shows 2 branches", () => {
      const { messages, branches } = collectScopeMessages(
        nestedForkTree,
        "AI3",
        nestedContentMap,
      );

      expect(messages).toHaveLength(2); // user3 + AI3
      expect(messages[0]).toMatchObject({ id: "user3", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI3", role: "assistant" });
      expect(branches).toHaveLength(2);
      expect(branches[0].nodeId).toBe("user5");
      expect(branches[1].nodeId).toBe("user6");
    });

    it("scope at nested fork leaf includes fork parent context", () => {
      const { messages, branches } = collectScopeMessages(
        nestedForkTree,
        "user6",
        nestedContentMap,
      );

      // user3 → AI3 (fork parent) + user6 → AI6
      expect(messages).toHaveLength(4);
      expect(messages[0]).toMatchObject({ id: "user3", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI3", role: "assistant" });
      expect(messages[2]).toMatchObject({ id: "user6", role: "user" });
      expect(messages[3]).toMatchObject({ id: "AI6", role: "assistant" });
      expect(branches).toHaveLength(0);
    });

    it("scope at original continuation leaf includes fork parent context", () => {
      const { messages, branches } = collectScopeMessages(
        nestedForkTree,
        "user5",
        nestedContentMap,
      );

      // user3 → AI3 (fork parent) + user5 → AI5
      expect(messages).toHaveLength(4);
      expect(messages[0]).toMatchObject({ id: "user3", role: "user" });
      expect(messages[1]).toMatchObject({ id: "AI3", role: "assistant" });
      expect(messages[2]).toMatchObject({ id: "user5", role: "user" });
      expect(messages[3]).toMatchObject({ id: "AI5", role: "assistant" });
      expect(branches).toHaveLength(0);
    });

    it("findBranchPoint at user3 → AI3 (the nested fork point)", () => {
      expect(findBranchPoint(nestedForkTree, "user3")).toBe("AI3");
    });

    it("findBranchPoint at user5 → AI5", () => {
      expect(findBranchPoint(nestedForkTree, "user5")).toBe("AI5");
    });

    it("findBranchPoint at user6 → AI6", () => {
      expect(findBranchPoint(nestedForkTree, "user6")).toBe("AI6");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: Integration Tests — Real SessionManager
// ═══════════════════════════════════════════════════════════════════════════
//
// Uses SessionManager.inMemory() to build real session trees and verify
// the full fork flow: append messages → branch → append more → verify tree.
//

/** Helper: append a user message and return its entry ID */
function appendUser(sm: SessionManager, text: string): string {
  return sm.appendMessage({
    role: "user",
    content: text,
    timestamp: Date.now(),
  });
}

/** Helper: append an assistant message and return its entry ID */
function appendAssistant(sm: SessionManager, text: string): string {
  return sm.appendMessage({
    role: "assistant",
    content: [{ type: "text", text }],
    api: "test",
    provider: "test",
    model: "test-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  } as any);
}

/** Walk the raw SM tree to find a node by entry ID */
interface SessionTreeNode {
  entry: { id: string; parentId: string | null; type: string; [k: string]: any };
  children: SessionTreeNode[];
}

function findInTree(
  roots: SessionTreeNode[],
  entryId: string,
): SessionTreeNode | null {
  for (const root of roots) {
    if (root.entry.id === entryId) return root;
    const found = findInTree(root.children, entryId);
    if (found) return found;
  }
  return null;
}

/**
 * Build a TreeNodeView from the raw SM tree for use with tree-nav helpers.
 * Wraps the SM tree nodes to look like the annotated tree the client sees.
 */
function toTreeNodeView(smNode: SessionTreeNode): TreeNodeView {
  const entry = smNode.entry;
  const msg = (entry as any).message;
  const role = msg?.role ?? "system";
  const text = extractText(msg);
  const label = role === "assistant" ? `✦ ${text}` : text;

  return {
    id: entry.id,
    parentId: entry.parentId,
    label,
    status: "completed",
    messageCount: smNode.children.length,
    children: smNode.children
      .filter((c) => c.entry.type === "message")
      .map((c) => toTreeNodeView(c)),
    isCurrent: false,
  };
}

function extractText(msg: any): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content.slice(0, 50);
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text ?? "")
      .join("")
      .slice(0, 50);
  }
  return "";
}

/** Build a ContentMap from the SM tree */
function buildContentMapFromTree(roots: SessionTreeNode[]): ContentMap {
  const map: ContentMap = new Map();
  const walk = (nodes: SessionTreeNode[]) => {
    for (const node of nodes) {
      const msg = (node.entry as any).message;
      if (msg && (msg.role === "user" || msg.role === "assistant")) {
        map.set(node.entry.id, {
          role: msg.role,
          content: extractText(msg),
          timestamp: node.entry.timestamp ?? "2026-01-01T00:00:00Z",
        });
      }
      walk(node.children);
    }
  };
  walk(roots);
  return map;
}

describe("Fork branching — integration tests (real SessionManager)", () => {
  // Build the linear conversation, then fork
  let sm: SessionManager;
  let user1Id: string;
  let ai1Id: string;
  let user2Id: string;
  let ai2Id: string;
  let user3Id: string;
  let ai3Id: string;
  let user4Id: string;
  let ai4Id: string;

  // Build once, reuse across tests in this describe block
  function buildForkedSession(): void {
    sm = SessionManager.inMemory("/test");

    // Build linear chain: user1 → AI1 → user2 → AI2 → user3 → AI3
    user1Id = appendUser(sm, "Hello");
    ai1Id = appendAssistant(sm, "Hi there");
    user2Id = appendUser(sm, "Tell me more");
    ai2Id = appendAssistant(sm, "Here's more detail");
    user3Id = appendUser(sm, "Thanks");
    ai3Id = appendAssistant(sm, "You're welcome");

    // Fork from AI2: branch back to AI2, then append new messages
    sm.branch(ai2Id);
    user4Id = appendUser(sm, "New branch question");
    ai4Id = appendAssistant(sm, "New branch answer");
  }

  describe("simpleBranch creates fork structure", () => {
    it("AI2 node has 2 children after fork", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const ai2Node = findInTree(tree, ai2Id);
      expect(ai2Node).not.toBeNull();
      // AI2 should have 2 message children: user3 and user4
      const msgChildren = ai2Node!.children.filter(
        (c) => c.entry.type === "message",
      );
      expect(msgChildren.length).toBe(2);
    });

    it("original path (user3→AI3) is preserved", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const user3Node = findInTree(tree, user3Id);
      expect(user3Node).not.toBeNull();
      const ai3Node = findInTree(tree, ai3Id);
      expect(ai3Node).not.toBeNull();
      // user3's parent should be AI2
      expect(user3Node!.entry.parentId).toBe(ai2Id);
      // AI3's parent should be user3
      expect(ai3Node!.entry.parentId).toBe(user3Id);
    });

    it("new branch path (user4→AI4) exists", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const user4Node = findInTree(tree, user4Id);
      expect(user4Node).not.toBeNull();
      const ai4Node = findInTree(tree, ai4Id);
      expect(ai4Node).not.toBeNull();
      // user4's parent should be AI2
      expect(user4Node!.entry.parentId).toBe(ai2Id);
      // AI4's parent should be user4
      expect(ai4Node!.entry.parentId).toBe(user4Id);
    });
  });

  describe("tree structure as TreeNodeView preserves fork", () => {
    it("annotated tree shows AI2 with 2 user children", () => {
      buildForkedSession();
      const tree = sm.getTree();

      // Build TreeNodeView from the raw tree (starting from root)
      // The root is the session header's first entry
      const rootView = toTreeNodeView(tree[0]);

      // Walk to AI2: root → user1 → AI1 → user2 → AI2
      // root is the session header, first message child is user1
      // But actually the SM tree root is the session_header entry.
      // Let's find AI2 in the tree and check its children directly.
      const ai2Node = findInTree(tree, ai2Id);
      expect(ai2Node).not.toBeNull();
      const ai2View = toTreeNodeView(ai2Node!);
      expect(ai2View.children).toHaveLength(2);

      // Both children should be user nodes (no ✦ prefix)
      for (const child of ai2View.children) {
        expect(child.label.startsWith("✦")).toBe(false);
      }
    });
  });

  describe("collectScopeMessages returns branch cards at fork points", () => {
    it("viewing scope at AI2 → shows both branches as BranchOptions", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const ai2Node = findInTree(tree, ai2Id)!;
      const user2Node = findInTree(tree, user2Id)!;

      // Build a subtree rooted at user2 for scope collection
      const subtree = toTreeNodeView(user2Node);
      const contentMap = buildContentMapFromTree(tree);

      // Viewing user2 scope: user2 → AI2 → fork
      const { messages, branches } = collectScopeMessages(
        subtree,
        user2Node.entry.id,
        contentMap,
      );

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: "user" });
      expect(messages[1]).toMatchObject({ role: "assistant" });
      expect(branches).toHaveLength(2);
    });

    it("viewing scope at user3 (original branch) → linear, no branches", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const user3Node = findInTree(tree, user3Id)!;

      const subtree = toTreeNodeView(user3Node);
      const contentMap = buildContentMapFromTree(tree);

      const { messages, branches } = collectScopeMessages(
        subtree,
        user3Node.entry.id,
        contentMap,
      );

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: "user" });
      expect(messages[1]).toMatchObject({ role: "assistant" });
      expect(branches).toHaveLength(0);
    });

    it("viewing scope at user4 (new branch) → linear, no branches", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const user4Node = findInTree(tree, user4Id)!;

      const subtree = toTreeNodeView(user4Node);
      const contentMap = buildContentMapFromTree(tree);

      const { messages, branches } = collectScopeMessages(
        subtree,
        user4Node.entry.id,
        contentMap,
      );

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: "user" });
      expect(messages[1]).toMatchObject({ role: "assistant" });
      expect(branches).toHaveLength(0);
    });
  });

  describe("findBranchPoint resolves correctly from real tree", () => {
    it("findBranchPoint from user2 view → AI2", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const user2Node = findInTree(tree, user2Id)!;
      const subtree = toTreeNodeView(user2Node);

      const result = findBranchPoint(subtree, user2Id);
      expect(result).toBe(ai2Id);
    });

    it("findBranchPoint from AI2 view → AI2", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const ai2Node = findInTree(tree, ai2Id)!;
      const subtree = toTreeNodeView(ai2Node);

      const result = findBranchPoint(subtree, ai2Id);
      expect(result).toBe(ai2Id);
    });

    it("findBranchPoint from user3 → AI3 (its own AI child)", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const user3Node = findInTree(tree, user3Id)!;
      const subtree = toTreeNodeView(user3Node);

      const result = findBranchPoint(subtree, user3Id);
      expect(result).toBe(ai3Id);
    });

    it("findBranchPoint from user4 → AI4 (its own AI child)", () => {
      buildForkedSession();
      const tree = sm.getTree();
      const user4Node = findInTree(tree, user4Id)!;
      const subtree = toTreeNodeView(user4Node);

      const result = findBranchPoint(subtree, user4Id);
      expect(result).toBe(ai4Id);
    });
  });

  describe("leaf pointer after fork", () => {
    it("leaf is at AI4 (last appended message in fork)", () => {
      buildForkedSession();
      expect(sm.getLeafId()).toBe(ai4Id);
    });

    it("getBranch from leaf follows the forked path", () => {
      buildForkedSession();
      const branch = sm.getBranch(ai4Id);
      const ids = branch.map((e) => e.id);

      // Path should include: header → user1 → AI1 → user2 → AI2 → user4 → AI4
      expect(ids).toContain(user1Id);
      expect(ids).toContain(ai1Id);
      expect(ids).toContain(user2Id);
      expect(ids).toContain(ai2Id);
      expect(ids).toContain(user4Id);
      expect(ids).toContain(ai4Id);

      // Should NOT include the original branch nodes
      expect(ids).not.toContain(user3Id);
      expect(ids).not.toContain(ai3Id);
    });
  });

  describe("nested fork (fork within a branch)", () => {
    let user5Id: string;
    let ai5Id: string;
    let user6Id: string;
    let ai6Id: string;

    function buildNestedForkSession(): void {
      buildForkedSession();

      // Now fork from AI3 (which is in the original branch)
      sm.branch(ai3Id);
      user5Id = appendUser(sm, "Nested fork question");
      ai5Id = appendAssistant(sm, "Nested fork answer");

      // Also add a continuation on the original AI3 path for comparison
      sm.branch(ai3Id);
      user6Id = appendUser(sm, "Another nested question");
      ai6Id = appendAssistant(sm, "Another nested answer");
    }

    it("AI3 has 2+ children after nested fork", () => {
      buildNestedForkSession();
      const tree = sm.getTree();
      const ai3Node = findInTree(tree, ai3Id);
      expect(ai3Node).not.toBeNull();
      const msgChildren = ai3Node!.children.filter(
        (c) => c.entry.type === "message",
      );
      expect(msgChildren.length).toBeGreaterThanOrEqual(2);
    });

    it("collectScopeMessages at AI3 → shows 2+ branches", () => {
      buildNestedForkSession();
      const tree = sm.getTree();
      const user3Node = findInTree(tree, user3Id)!;

      const subtree = toTreeNodeView(user3Node);
      const contentMap = buildContentMapFromTree(tree);

      const { messages, branches } = collectScopeMessages(
        subtree,
        user3Id,
        contentMap,
      );

      // user3 → AI3 → fork
      expect(messages).toHaveLength(2);
      expect(branches.length).toBeGreaterThanOrEqual(2);
    });

    it("scope at nested fork leaf → linear, no branches", () => {
      buildNestedForkSession();
      const tree = sm.getTree();
      const user5Node = findInTree(tree, user5Id)!;

      const subtree = toTreeNodeView(user5Node);
      const contentMap = buildContentMapFromTree(tree);

      const { messages, branches } = collectScopeMessages(
        subtree,
        user5Id,
        contentMap,
      );

      expect(messages).toHaveLength(2);
      expect(branches).toHaveLength(0);
    });

    it("getBranch from nested fork follows correct path", () => {
      buildNestedForkSession();
      const branch = sm.getBranch(ai5Id);
      const ids = branch.map((e) => e.id);

      // Should include: ... → AI2 → user3 → AI3 → user5 → AI5
      expect(ids).toContain(ai2Id);
      expect(ids).toContain(user3Id);
      expect(ids).toContain(ai3Id);
      expect(ids).toContain(user5Id);
      expect(ids).toContain(ai5Id);

      // Should NOT include the other fork path
      expect(ids).not.toContain(user4Id);
      expect(ids).not.toContain(ai4Id);
    });
  });

  describe("multiple forks from same node", () => {
    it("supports 3+ branches from the same AI node", () => {
      sm = SessionManager.inMemory("/test");
      const u1 = appendUser(sm, "Question");
      const a1 = appendAssistant(sm, "Answer");

      // Branch 1
      sm.branch(a1);
      const b1User = appendUser(sm, "Branch 1");
      appendAssistant(sm, "Branch 1 answer");

      // Branch 2
      sm.branch(a1);
      const b2User = appendUser(sm, "Branch 2");
      appendAssistant(sm, "Branch 2 answer");

      // Branch 3
      sm.branch(a1);
      const b3User = appendUser(sm, "Branch 3");
      appendAssistant(sm, "Branch 3 answer");

      const tree = sm.getTree();
      const a1Node = findInTree(tree, a1);
      expect(a1Node).not.toBeNull();

      const msgChildren = a1Node!.children.filter(
        (c) => c.entry.type === "message",
      );
      expect(msgChildren.length).toBe(3);

      // Verify all three branches are distinct
      const childIds = msgChildren.map((c) => c.entry.id);
      expect(childIds).toContain(b1User);
      expect(childIds).toContain(b2User);
      expect(childIds).toContain(b3User);
    });
  });

  describe("getEntries preserves all entries across forks", () => {
    it("all messages from both branches appear in flat entry list", () => {
      buildForkedSession();
      const entries = sm.getEntries();
      const msgEntries = entries.filter((e) => e.type === "message");

      // Should have all 8 messages: user1, AI1, user2, AI2, user3, AI3, user4, AI4
      expect(msgEntries.length).toBe(8);

      const ids = msgEntries.map((e) => e.id);
      expect(ids).toContain(user1Id);
      expect(ids).toContain(ai1Id);
      expect(ids).toContain(user2Id);
      expect(ids).toContain(ai2Id);
      expect(ids).toContain(user3Id);
      expect(ids).toContain(ai3Id);
      expect(ids).toContain(user4Id);
      expect(ids).toContain(ai4Id);
    });
  });
});
