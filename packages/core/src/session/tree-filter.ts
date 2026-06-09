/**
 * Pure utility functions for filtering tree nodes.
 * Extracted from PiSession for testability.
 */

import type { TopicMeta } from "../types/index.js";

/**
 * Check if an entry has been abandoned (soft-deleted).
 * An entry is abandoned if:
 * - Its topic metadata has status "abandoned", OR
 * - There's a statusOverride entry marking it as "abandoned"
 */
export function isAbandoned(
  entryId: string,
  meta: TopicMeta | null,
  statusOverrides: Map<string, string>,
): boolean {
  if (meta?.status === "abandoned") return true;
  return statusOverrides.get(entryId) === "abandoned";
}

/**
 * Filter a tree of nodes, removing abandoned subtrees.
 * Works on TreeNodeView (the client-facing tree type).
 */
export function filterAbandonedNodes<T extends { id: string; children: T[] }>(
  nodes: T[],
  abandonedIds: Set<string>,
): T[] {
  return nodes
    .filter((n) => !abandonedIds.has(n.id))
    .map((n) => ({
      ...n,
      children: filterAbandonedNodes(n.children, abandonedIds),
    }));
}
