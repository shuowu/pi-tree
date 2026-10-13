/**
 * TreeManager branching against the REAL tree builder.
 *
 * tree-manager-branching.test.ts mocks `getAnnotatedTree()`, so it can't see
 * what PiSession's tree building does to fork placeholders (flattening,
 * placeholder nodes sitting between AI turns). Here a real PiSession runs on
 * an in-memory SessionManager; only the LLM call is stubbed.
 */

import { describe, it, expect } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { PiSession, type TreeNodeView } from "@pi-tree/core";
import { TreeManager } from "../services/tree-manager.js";

function createSession() {
  const sm = SessionManager.inMemory("/test");
  // No agent → bypass PiSession.create(); stub sendMessage to record a turn.
  const pi = new (PiSession as unknown as new (...args: unknown[]) => PiSession)(
    sm, null, "book", "/lib",
  );
  (pi as unknown as { sendMessage: PiSession["sendMessage"] }).sendMessage = async (msg) => {
    sm.appendMessage({ role: "user", content: msg, timestamp: Date.now() } as never);
    const response = `ans(${msg})`;
    const entryId = sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: response }],
      api: "test",
      provider: "test",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    } as never);
    return { response, entryId };
  };
  return TreeManager._createForTest(pi);
}

function find(tree: TreeNodeView, label: string): TreeNodeView {
  const walk = (n: TreeNodeView): TreeNodeView | null =>
    n.label === label || n.label === `✦ ${label}`
      ? n
      : (n.children ?? []).reduce<TreeNodeView | null>((acc, c) => acc ?? walk(c), null);
  const found = walk(tree);
  if (!found) throw new Error(`node "${label}" not in tree`);
  return found;
}

const childLabels = (tree: TreeNodeView, label: string) =>
  (find(tree, label).children ?? []).map((c) => c.label);

/** Send a linear chain of messages, each continuing from the last. */
async function chain(tm: TreeManager, ...msgs: string[]) {
  let viewNodeId: string | null = null;
  for (const m of msgs) viewNodeId = (await tm.handleMessage(m, viewNodeId)).viewNodeId;
}

describe("TreeManager branching — real tree", () => {
  it("focus a mid-chain turn (linear) → new branch under its answer", async () => {
    const tm = createSession();
    await chain(tm, "P1", "P2", "P3");
    const p1 = find(tm.getSessionState().tree, "P1").id;

    const s = await tm.handleMessage("NEW", p1, { forceBranch: true });

    expect(childLabels(s.tree, "ans(P1)")).toEqual(["P2", "NEW"]);
    expect(childLabels(s.tree, "ans(P3)")).toEqual([]);
    // Follow-ups continue inside the new branch
    expect(s.viewNodeId).toBe(find(s.tree, "NEW").id);
  });

  it("focus the last turn → continues linearly", async () => {
    const tm = createSession();
    await chain(tm, "P1", "P2");
    const p2 = find(tm.getSessionState().tree, "P2").id;

    const s = await tm.handleMessage("P3", p2, { forceBranch: true });

    expect(childLabels(s.tree, "ans(P2)")).toEqual(["P3"]);
  });

  it("focus a turn above a deeper fork → branch under the focused turn, not the fork", async () => {
    const tm = createSession();
    await chain(tm, "P1", "P2", "P3");
    // ⑂ on ans(P3) → fork under ans(P2)
    const f = tm.forkAtNode(find(tm.getSessionState().tree, "ans(P3)").id);
    await tm.handleMessage("B1", f.forkScopeId, { forceBranch: true });
    const p1 = find(tm.getSessionState().tree, "P1").id;

    const s = await tm.handleMessage("NEW", p1, { forceBranch: true });

    expect(childLabels(s.tree, "ans(P1)")).toEqual(["P2", "NEW"]);
    expect(childLabels(s.tree, "ans(P2)")).toEqual(["P3", "B1"]);
  });

  it("⑂ on the first answer inside a ⑂ branch → sibling branch, answer stays visible", async () => {
    const tm = createSession();
    await chain(tm, "P1", "P2");
    let f = tm.forkAtNode(find(tm.getSessionState().tree, "ans(P2)").id);
    let s = await tm.handleMessage("B1", f.forkScopeId, { forceBranch: true });
    expect(childLabels(s.tree, "ans(P1)")).toEqual(["P2", "B1"]);

    f = tm.forkAtNode(find(s.tree, "ans(B1)").id);
    s = await tm.handleMessage("B2", f.forkScopeId, { forceBranch: true });

    expect(childLabels(s.tree, "ans(P1)")).toEqual(["P2", "B1", "B2"]);
    expect(childLabels(s.tree, "B1")).toEqual(["✦ ans(B1)"]);
  });

  it("⑂ on the session's only answer keeps it in the tree", async () => {
    const tm = createSession();
    await chain(tm, "P1");
    // No turn before P1 → the fork placeholder goes under ans(P1) itself
    const f = tm.forkAtNode(find(tm.getSessionState().tree, "ans(P1)").id);
    expect(childLabels(f.state.tree, "P1")).toEqual(["✦ ans(P1)"]);

    const s = await tm.handleMessage("C1", f.forkScopeId, { forceBranch: true });
    expect(childLabels(s.tree, "ans(P1)")).toEqual(["C1"]);
  });
});
