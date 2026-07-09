/**
 * Pure-logic helpers extracted from useReaderSession so they can be
 * unit-tested without React, routers, or DOM dependencies.
 */

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
