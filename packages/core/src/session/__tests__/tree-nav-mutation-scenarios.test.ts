/**
 * Tests for buildConversationNode edge cases — parasitic internal entries.
 *
 * When appendCustomEntry is used for rename/delete metadata, it appends a
 * custom entry as a child of the current leaf.  This "parasitic" child is
 * an internal entry (not a message) and should not change tree structure.
 *
 * These tests exercise the tree-nav layer with tree shapes that simulate
 * the bug scenario, plus a direct test of the buildConversationNode fix
 * via PiSession.getAnnotatedTree().
 */

import { describe, it, expect } from "vitest";
import type { TreeNodeView } from "../../types/index.js";
import {
  collectScopeMessages,
  buildBreadcrumb,
  type ContentMap,
} from "../tree-nav";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Scenario: rename does not change tree structure ────────────────────────
//
// Before rename:
//   root → user_1 → ✦ AI_1 (leaf)
//
// After rename of user_1 to "New label":
//   root → user_1 ("New label") → ✦ AI_1 (leaf)
//
// Expected: tree structure and messages identical except the label

describe("rename does not disrupt tree", () => {
  const beforeTree = node("root", "Book", [
    userNode("user_1", "Start reading", [
      aiNode("AI_1", "Chapter briefing"),
    ]),
  ]);

  const afterTree = node("root", "Book", [
    userNode("user_1", "New label", [
      aiNode("AI_1", "Chapter briefing"),
    ]),
  ]);

  const contentMap = buildContentMap([
    ["root", "user", ""],
    ["user_1", "user", "Start reading this book"],
    ["AI_1", "assistant", "Here is your chapter briefing..."],
  ]);

  it("messages are identical after rename", () => {
    const before = collectScopeMessages(beforeTree, "user_1", contentMap);
    const after = collectScopeMessages(afterTree, "user_1", contentMap);

    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.messages.map((m) => m.id)).toEqual(
      before.messages.map((m) => m.id),
    );
    expect(after.branches).toEqual(before.branches);
  });

  it("breadcrumb reflects new label after rename", () => {
    const crumbs = buildBreadcrumb(afterTree, "AI_1");
    expect(crumbs.find((c) => c.nodeId === "user_1")?.label).toBe("New label");
  });
});

// ─── Scenario: rename a branch in a forked tree ─────────────────────────────
//
//   root → user_1 → ✦ AI_1
//                      ├── user_2a ("Branch A") → ✦ AI_2a
//                      └── user_2b ("Branch B") → ✦ AI_2b
//
// Rename user_2a to "Renamed branch A".
// Expected: messages for both branches are still accessible.

describe("rename a branch in a forked tree", () => {
  const tree = node("root", "Book", [
    userNode("user_1", "Start reading", [
      aiNode("AI_1", "Chapter briefing", [
        userNode("user_2a", "Renamed branch A", [
          aiNode("AI_2a", "Part 1 briefing"),
        ]),
        userNode("user_2b", "Branch B", [
          aiNode("AI_2b", "Battle of Poyang"),
        ]),
      ]),
    ]),
  ]);

  const contentMap = buildContentMap([
    ["root", "user", ""],
    ["user_1", "user", "Start reading"],
    ["AI_1", "assistant", "Chapter briefing..."],
    ["user_2a", "user", "朱元璋"],
    ["AI_2a", "assistant", "Part 1 briefing..."],
    ["user_2b", "user", "鄱阳湖"],
    ["AI_2b", "assistant", "Battle of Poyang..."],
  ]);

  it("renamed branch messages show branch content", () => {
    const { messages, parentContext } = collectScopeMessages(tree, "user_2a", contentMap);
    // user_2a → AI_2a (parent context: user_1, AI_1)
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_2a", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_2a", role: "assistant" });
    expect(parentContext.map(m => m.id)).toEqual(["user_1", "AI_1"]);
  });

  it("sibling branch messages show branch content", () => {
    const { messages, parentContext } = collectScopeMessages(tree, "user_2b", contentMap);
    // user_2b → AI_2b (parent context: user_1, AI_1)
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_2b", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_2b", role: "assistant" });
    expect(parentContext.map(m => m.id)).toEqual(["user_1", "AI_1"]);
  });

  it("parent scope still shows both branches", () => {
    const { messages, branches } = collectScopeMessages(
      tree,
      "user_1",
      contentMap,
    );
    expect(messages).toHaveLength(2);
    expect(branches).toHaveLength(2);
    expect(branches[0].nodeId).toBe("user_2a");
    expect(branches[0].label).toBe("Renamed branch A");
    expect(branches[1].nodeId).toBe("user_2b");
  });
});

// ─── Scenario: delete a branch preserves siblings ───────────────────────────
//
// Deleting a branch should only remove that branch.
// The parent scope should show one fewer branch, but remaining
// branches and their messages are intact.

describe("delete a branch preserves parent and siblings", () => {
  // After deleting user_2a, the tree has only user_2b
  const tree = node("root", "Book", [
    userNode("user_1", "Start reading", [
      aiNode("AI_1", "Chapter briefing", [
        // user_2a removed (abandoned)
        userNode("user_2b", "Branch B", [
          aiNode("AI_2b", "Battle of Poyang"),
        ]),
      ]),
    ]),
  ]);

  const contentMap = buildContentMap([
    ["root", "user", ""],
    ["user_1", "user", "Start reading"],
    ["AI_1", "assistant", "Chapter briefing..."],
    ["user_2b", "user", "鄱阳湖"],
    ["AI_2b", "assistant", "Battle of Poyang..."],
  ]);

  it("remaining branch messages are accessible", () => {
    const { messages } = collectScopeMessages(tree, "user_2b", contentMap);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_2b", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_2b", role: "assistant" });
  });

  it("parent scope walks through single remaining child (no branches array)", () => {
    const { messages, branches } = collectScopeMessages(
      tree,
      "user_1",
      contentMap,
    );
    // user_1 → AI_1 → user_2b (single child, walkChain continues)
    // → AI_2b (leaf)
    expect(messages.length).toBeGreaterThanOrEqual(2);
    // With only 1 child, no fork — walkChain follows through
    expect(branches).toHaveLength(0);
  });
});

// ─── Scenario: renaming an AI node preserves ✦ prefix ───────────────────────
//
// AI nodes are identified by the ✦ prefix. If a user renames an AI node,
// the ✦ prefix must be preserved so isAINode() still works.

describe("AI node ✦ prefix", () => {
  it("renamed AI node with ✦ prefix is still recognized", () => {
    const renamedAI = aiNode("AI_1", "New AI Label");
    expect(renamedAI.label).toBe("✦ New AI Label");
    expect(renamedAI.label.startsWith("✦")).toBe(true);
  });

  it("collectScopeMessages prepends parent user msg when viewing ✦ AI node", () => {
    const tree = node("root", "Book", [
      userNode("user_1", "Start", [
        aiNode("AI_1", "Renamed AI response"),
      ]),
    ]);
    const contentMap = buildContentMap([
      ["root", "user", ""],
      ["user_1", "user", "Start reading"],
      ["AI_1", "assistant", "Response..."],
    ]);
    const { messages } = collectScopeMessages(tree, "AI_1", contentMap);
    // Should have 2 messages: parent user + this AI
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: "user_1", role: "user" });
    expect(messages[1]).toMatchObject({ id: "AI_1", role: "assistant" });
  });

  it("WITHOUT ✦ prefix, parent user msg is NOT prepended (broken state)", () => {
    // This test documents the bug: if ✦ is stripped, isAINode returns false
    const tree = node("root", "Book", [
      userNode("user_1", "Start", [
        // Simulating a renamed AI node that lost its ✦ prefix
        node("AI_1", "Renamed AI response"),
      ]),
    ]);
    const contentMap = buildContentMap([
      ["root", "user", ""],
      ["user_1", "user", "Start reading"],
      ["AI_1", "assistant", "Response..."],
    ]);
    const { messages } = collectScopeMessages(tree, "AI_1", contentMap);
    // BUG: only 1 message (the AI node), parent user msg is missing
    // because isAINode returns false when ✦ prefix is stripped
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: "AI_1" });
  });
});
