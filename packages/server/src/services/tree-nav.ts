/**
 * tree-nav.ts — Pure tree navigation helpers.
 *
 * No Pi SDK or session dependency. Operates on TreeNodeView and content maps.
 * Fully unit-testable.
 */

import type {
  TreeNodeView,
  ChatMessage,
  BranchOption,
  BreadcrumbItem,
} from "@pi-books/shared";

// ─── Predicates ────────────────────────────────────────────────────────────────

/** AI response nodes are prefixed with ✦ in the tree label. */
export function isAINode(node: TreeNodeView): boolean {
  return node.label.startsWith("✦");
}

// ─── Node Lookup ───────────────────────────────────────────────────────────────

/** Find a node by ID anywhere in the tree (DFS). */
export function findNode(
  tree: TreeNodeView,
  nodeId: string,
): TreeNodeView | null {
  if (tree.id === nodeId) return tree;
  for (const child of tree.children ?? []) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return null;
}

/** Find the parent of a node in the tree. Returns null for the root. */
export function findParent(
  tree: TreeNodeView,
  targetId: string,
): TreeNodeView | null {
  for (const child of tree.children ?? []) {
    if (child.id === targetId) return tree;
    const found = findParent(child, targetId);
    if (found) return found;
  }
  return null;
}

// ─── Branch Point Resolution ───────────────────────────────────────────────────

/**
 * Find the AI node to branch from when the user sends a message
 * while viewing `viewNodeId`.
 *
 * Rules:
 *  - If viewNodeId is an AI node → branch from it.
 *  - If viewNodeId is a user/outline node → find the first AI child
 *    in a single-child walk and branch from it.
 *  - If no AI child exists (leaf user node with no response yet) →
 *    return the node itself (will append, not branch).
 *
 * CRITICAL: This never walks past the first AI node. After message 1
 * creates a branch under AI, message 2 still returns the same AI node.
 */
export function findBranchPoint(
  tree: TreeNodeView,
  viewNodeId: string,
): string | null {
  const node = findNode(tree, viewNodeId);
  if (!node) return null;

  // If we're already on an AI node, that's the branch point
  if (isAINode(node)) return node.id;

  // Walk single-child paths from the user/outline node to find the first AI
  let current = node;
  while (current.children?.length >= 1) {
    // Look for an AI child among the children
    const aiChild = current.children.find((c) => isAINode(c));
    if (aiChild) return aiChild.id;

    // If there's exactly one child and it's not AI, keep walking
    // (handles root → user chains, etc.)
    if (current.children.length === 1) {
      current = current.children[0];
    } else {
      // Multiple non-AI children — fork without AI, branch from here
      break;
    }
  }

  // Fallback: no AI found, branch from the node itself
  return current.id;
}

// ─── Scope Message Collection ──────────────────────────────────────────────────

export type ContentMap = Map<
  string,
  { role: string; content: string; timestamp: string }
>;

export interface ScopeResult {
  messages: ChatMessage[];
  branches: BranchOption[];
}

/**
 * Collect messages and branches for a scoped view.
 *
 * Walks the linear chain from `viewNodeId` until a fork or leaf.
 * If viewNodeId is an AI node, the parent user message is prepended
 * so the full user→AI pair is always visible.
 */
export function collectScopeMessages(
  tree: TreeNodeView,
  viewNodeId: string | null,
  contentMap: ContentMap,
): ScopeResult {
  const startNode = viewNodeId ? findNode(tree, viewNodeId) : tree;
  if (!startNode) return { messages: [], branches: [] };

  const messages: ChatMessage[] = [];
  const branches: BranchOption[] = [];

  // If starting at an AI node, include the preceding user message
  if (isAINode(startNode)) {
    const parent = findParent(tree, startNode.id);
    if (parent) {
      pushMessage(parent.id, contentMap, messages);
    }
  }

  // Walk the linear chain
  walkChain(startNode, messages, branches, contentMap);

  return { messages, branches };
}

/**
 * Recursively walk a linear chain, collecting messages.
 * Stops at forks (2+ children) and reports branches.
 */
function walkChain(
  node: TreeNodeView,
  messages: ChatMessage[],
  branches: BranchOption[],
  contentMap: ContentMap,
): void {
  pushMessage(node.id, contentMap, messages);

  if (!node.children || node.children.length === 0) {
    return; // Leaf — done
  }

  if (node.children.length === 1) {
    walkChain(node.children[0], messages, branches, contentMap);
  } else {
    // Fork — report branches
    for (const child of node.children) {
      branches.push({
        nodeId: child.id,
        label: child.label,
        messageCount: child.messageCount,
        status: child.status,
      });
    }
  }
}

/** Push a message from contentMap into the messages array (if it exists and is non-empty). */
function pushMessage(
  nodeId: string,
  contentMap: ContentMap,
  messages: ChatMessage[],
): void {
  const data = contentMap.get(nodeId);
  if (data && data.content.trim()) {
    messages.push({
      id: nodeId,
      role: data.role as "user" | "assistant",
      content: data.content,
      timestamp: data.timestamp,
    });
  }
}

// ─── Breadcrumb ────────────────────────────────────────────────────────────────

/** Build the breadcrumb path from root to a target node. */
export function buildBreadcrumb(
  tree: TreeNodeView,
  targetId: string,
): BreadcrumbItem[] {
  const path: BreadcrumbItem[] = [];

  const walk = (node: TreeNodeView): boolean => {
    if (node.id === targetId) {
      path.push({ nodeId: node.id, label: node.label });
      return true;
    }
    for (const child of node.children ?? []) {
      if (walk(child)) {
        path.unshift({ nodeId: node.id, label: node.label });
        return true;
      }
    }
    return false;
  };

  walk(tree);
  return path;
}
