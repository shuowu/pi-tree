import { describe, it, expect } from "vitest";
import { isAbandoned, filterAbandonedNodes } from "../tree-filter.js";
import type { TopicMeta } from "../pi-session.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeMeta(status: "active" | "completed" | "abandoned"): TopicMeta {
  return {
    kind: "topic_node",
    label: "Test",
    source: "user",
    status,
  };
}

interface SimpleNode {
  id: string;
  children: SimpleNode[];
}

function makeTree(id: string, children: SimpleNode[] = []): SimpleNode {
  return { id, children };
}

// ─── isAbandoned ───────────────────────────────────────────────────────────────

describe("isAbandoned", () => {
  it("returns false when no meta and no overrides", () => {
    expect(isAbandoned("node-1", null, new Map())).toBe(false);
  });

  it("returns false for active meta without overrides", () => {
    expect(isAbandoned("node-1", makeMeta("active"), new Map())).toBe(false);
  });

  it("returns false for completed meta without overrides", () => {
    expect(isAbandoned("node-1", makeMeta("completed"), new Map())).toBe(false);
  });

  it("returns true for abandoned meta", () => {
    expect(isAbandoned("node-1", makeMeta("abandoned"), new Map())).toBe(true);
  });

  it("returns true when statusOverrides has abandoned", () => {
    const overrides = new Map([["node-1", "abandoned"]]);
    expect(isAbandoned("node-1", null, overrides)).toBe(true);
  });

  it("returns true when statusOverrides has abandoned even with active meta", () => {
    const overrides = new Map([["node-1", "abandoned"]]);
    // This case shouldn't normally happen since rebuildTopicCache applies overrides
    // to meta, but the function should handle it defensively
    expect(isAbandoned("node-1", makeMeta("active"), overrides)).toBe(true);
  });

  it("returns false when overrides has different status", () => {
    const overrides = new Map([["node-1", "completed"]]);
    expect(isAbandoned("node-1", null, overrides)).toBe(false);
  });

  it("returns false when overrides has a different node ID", () => {
    const overrides = new Map([["node-2", "abandoned"]]);
    expect(isAbandoned("node-1", null, overrides)).toBe(false);
  });

  it("handles meta with abandoned status taking precedence (short-circuit)", () => {
    // Meta is abandoned — should return true without even checking overrides
    const overrides = new Map([["node-1", "active"]]);
    expect(isAbandoned("node-1", makeMeta("abandoned"), overrides)).toBe(true);
  });
});

// ─── filterAbandonedNodes ──────────────────────────────────────────────────────

describe("filterAbandonedNodes", () => {
  it("returns all nodes when none are abandoned", () => {
    const tree = [
      makeTree("a", [makeTree("b"), makeTree("c")]),
    ];
    const result = filterAbandonedNodes(tree, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(2);
  });

  it("removes abandoned top-level nodes", () => {
    const tree = [
      makeTree("a"),
      makeTree("b"),
    ];
    const result = filterAbandonedNodes(tree, new Set(["a"]));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("removes abandoned child nodes", () => {
    const tree = [
      makeTree("a", [makeTree("b"), makeTree("c")]),
    ];
    const result = filterAbandonedNodes(tree, new Set(["b"]));
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].id).toBe("c");
  });

  it("removes abandoned nodes at multiple levels", () => {
    const tree = [
      makeTree("a", [
        makeTree("b", [makeTree("d"), makeTree("e")]),
        makeTree("c"),
      ]),
    ];
    const result = filterAbandonedNodes(tree, new Set(["b", "c"]));
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(0);
  });

  it("removing a parent implicitly removes its subtree", () => {
    const tree = [
      makeTree("a", [
        makeTree("b", [makeTree("c")]),
      ]),
    ];
    const result = filterAbandonedNodes(tree, new Set(["b"]));
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(0);
    // "c" is gone because its parent "b" was removed
  });

  it("handles empty tree", () => {
    const result = filterAbandonedNodes([], new Set(["a"]));
    expect(result).toHaveLength(0);
  });

  it("handles empty abandoned set", () => {
    const tree = [makeTree("a", [makeTree("b")])];
    const result = filterAbandonedNodes(tree, new Set());
    expect(result).toEqual(tree);
  });

  it("preserves remaining sibling when one is abandoned", () => {
    const tree = [
      makeTree("root", [
        makeTree("branch-a", [makeTree("leaf-a1"), makeTree("leaf-a2")]),
        makeTree("branch-b", [makeTree("leaf-b1")]),
      ]),
    ];
    const result = filterAbandonedNodes(tree, new Set(["branch-a"]));
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].id).toBe("branch-b");
    expect(result[0].children[0].children).toHaveLength(1);
  });
});
