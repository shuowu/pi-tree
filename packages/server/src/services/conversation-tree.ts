/**
 * conversation-tree.ts — Extracted decision logic for building conversation trees.
 *
 * Pulled out of PiSession.buildConversationNode for testability.
 * These pure functions determine whether/how to display an assistant node
 * in the conversation tree.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MeaningfulChild {
  entryId: string;
  source: string;
  label: string;
}

export interface AssistantNodeContext {
  /** Number of raw Pi SDK children (includes internal entries) */
  rawChildCount: number;
  /** Children that resolved to visible conversation nodes */
  meaningfulChildren: MeaningfulChild[];
}

export interface AssistantNodeResult {
  /** Whether to show this node in the tree */
  show: boolean;
  /** If shown, the status */
  status?: "active" | "completed";
  /** If not shown, whether to flatten (pass single child through) */
  flatten?: boolean;
}

// ─── Logic ──────────────────────────────────────────────────────────────────

/**
 * Determine whether an assistant message node should be shown in the
 * conversation tree, and if so, what status it should have.
 *
 * Rules:
 * - Leaf node (no raw children) → show as active
 * - Has only internal children that resolve to nothing → treat as leaf (active)
 * - Branch point (2+ meaningful children) → show as completed
 * - Final response (has user/outline children) → show as completed
 * - Single non-user/outline child → flatten (don't show, pass child through)
 * - No meaningful children and no raw children → null (shouldn't display)
 */
export function shouldShowAssistantNode(
  ctx: AssistantNodeContext,
): AssistantNodeResult {
  const { rawChildCount, meaningfulChildren } = ctx;

  const isLeaf = rawChildCount === 0;
  const hasOnlyInternalChildren = rawChildCount > 0 && meaningfulChildren.length === 0;
  const isBranchPoint = meaningfulChildren.length > 1;
  const isFinalResponse = meaningfulChildren.some(
    (c) => c.source === "user" || c.source === "outline",
  );

  // Show the node in these cases:
  if (isLeaf || hasOnlyInternalChildren || isBranchPoint || isFinalResponse) {
    return {
      show: true,
      status: isLeaf || hasOnlyInternalChildren ? "active" : "completed",
    };
  }

  // Single child that's not user/outline → flatten
  if (meaningfulChildren.length === 1) {
    return { show: false, flatten: true };
  }

  // Fallback: no children at all (shouldn't happen after the above, but defensive)
  return { show: false };
}
