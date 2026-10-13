/**
 * Pure-logic helpers extracted from useReaderSession so they can be
 * unit-tested without React, routers, or DOM dependencies.
 */

import type { TreeNodeView } from "@pi-tree/core/types";

/**
 * Decide which node a new message should be sent from and whether
 * it should force-branch.
 *
 * Called at the top of `handleSendMessage`.  The function also returns
 * the updated `lastViewNodeId` so the caller can sync its ref.
 */
export function resolveSendContext(
  pendingForkScope: string | null,
  lastViewNodeId: string | null,
): {
  sendingNodeId: string | null;
  forceBranch: boolean;
  /** Value to write back to `lastViewNodeIdRef` (matches sendingNodeId when forking) */
  nextLastViewNodeId: string | null;
} {
  const sendingNodeId = pendingForkScope ?? lastViewNodeId;
  const forceBranch = pendingForkScope != null;

  // When forking, sync the ref so the stream-done handler's guard
  // (lastViewNodeIdRef === sendingNodeId) passes.
  const nextLastViewNodeId = forceBranch ? sendingNodeId : lastViewNodeId;

  return { sendingNodeId, forceBranch, nextLastViewNodeId };
}

/**
 * Decide whether the stream-done handler should apply its result
 * (update messages, URL, reset isLoading) or skip because the user
 * has navigated away.
 */
export function shouldApplyStreamResult(
  lastViewNodeId: string | null,
  sendingNodeId: string | null,
): boolean {
  return lastViewNodeId === sendingNodeId;
}

/**
 * Decide what the stream-done handler should do with a successful result.
 *
 * - "apply": apply the result and follow it (auto-nav to the result node).
 * - "stay-notify": the response branched to a new node but the user scrolled
 *   away to read something — keep the current view and show a notification.
 * - "skip-notify": the user navigated to a different node entirely — don't
 *   touch the view, just show a notification.
 */
export function resolveStreamDoneAction(params: {
  lastViewNodeId: string | null;
  sendingNodeId: string | null;
  resultViewNodeId: string | null;
  /** Whether the user is still following the live stream (hasn't scrolled away) */
  isFollowing: boolean;
}): "apply" | "stay-notify" | "skip-notify" {
  const { lastViewNodeId, sendingNodeId, resultViewNodeId, isFollowing } = params;
  if (!shouldApplyStreamResult(lastViewNodeId, sendingNodeId)) {
    return "skip-notify";
  }
  const branched = resultViewNodeId !== sendingNodeId;
  if (branched && !isFollowing) {
    return "stay-notify";
  }
  return "apply";
}

/**
 * Decide whether focusing `nodeId` in the sidebar should anchor the next
 * message as a reply to that turn.
 *
 * Focusing a turn (its question or its ✦ answer) means "reply here". When the
 * turn's answer already has visible children, a reply there starts a new
 * branch — but the chat view still shows the chain continuing below, so the
 * reply must be routed explicitly (forceBranch from the focused turn) and
 * surfaced in the UI. Returns null when no anchor is needed: the turn is the
 * end of its chain (a normal send continues it) or it has no answer yet.
 */
export function resolveFocusAnchor(
  tree: TreeNodeView | null,
  nodeId: string,
): { nodeId: string; label: string } | null {
  if (!tree) return null;
  const find = (n: TreeNodeView): TreeNodeView | null => {
    if (n.id === nodeId) return n;
    for (const c of n.children ?? []) {
      const found = find(c);
      if (found) return found;
    }
    return null;
  };
  const node = find(tree);
  if (!node) return null;

  const isAI = (n: TreeNodeView) => n.label.startsWith("✦");
  const answer = isAI(node) ? node : (node.children ?? []).find(isAI);
  if (!answer) return null;

  // Unused ⑂ placeholders are hidden from the user — they don't count.
  const replies = (answer.children ?? []).filter(
    (c) => !(c.status === "placeholder" && (c.messageCount ?? 0) === 0),
  );
  if (replies.length === 0) return null;

  // Label the anchor by the question, which is what the user recognises.
  const question = isAI(node) ? findParentOf(tree, node.id) ?? node : node;
  return { nodeId, label: question.label.replace(/^✦\s*/, "") };
}

function findParentOf(tree: TreeNodeView, id: string): TreeNodeView | null {
  for (const c of tree.children ?? []) {
    if (c.id === id) return tree;
    const found = findParentOf(c, id);
    if (found) return found;
  }
  return null;
}
