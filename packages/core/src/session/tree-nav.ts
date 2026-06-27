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
} from "../types/index.js";

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

/**
 * Find the correct fork point for the ⑂ button.
 *
 * When the user clicks ⑂ on an AI message (e.g., AI_c2), the intent is
 * "branch BEFORE this conversation turn".  The fork point is the
 * **grandparent AI node**: parent(user_node) → parent(AI_clicked).
 *
 *   AI_c2 clicked → parent = c2_user → parent = AI_c1 → fork at AI_c1
 *
 * Returns `{ forkId, scopeId }` where:
 *  - `forkId` is the AI node to pass to `simpleBranch`
 *  - `scopeId` is the parent user node to use as viewNodeId for the client
 *
 * Falls back to the node itself when no grandparent AI exists (root level).
 */
export function findForkPoint(
  tree: TreeNodeView,
  clickedNodeId: string,
): { forkId: string; scopeId: string | null } | null {
  const node = findNode(tree, clickedNodeId);
  if (!node) return null;

  // Walk up: clicked AI → parent (user node) → grandparent (AI node)
  const parentUser = findParent(tree, clickedNodeId);
  if (!parentUser) {
    // No parent — fall back to the node itself
    return { forkId: node.id, scopeId: null };
  }

  const grandparentAI = findParent(tree, parentUser.id);
  if (grandparentAI && isAINode(grandparentAI)) {
    // Found the grandparent AI — this is the fork point
    // Scope to the parent user node (the conversation turn the user clicked on)
    return {
      forkId: grandparentAI.id,
      scopeId: parentUser.id,
    };
  }

  // No grandparent AI (root level) — fall back to the node itself
  return { forkId: node.id, scopeId: parentUser.id };
}

// ─── Linear-First Branching ────────────────────────────────────────────────────

/**
 * Find the deepest node marked as current (active leaf) in the tree.
 *
 * `isCurrent` is set on ALL nodes along the path from root to the
 * active leaf (via `isOnCurrentPath`).  A naive DFS would return the
 * root — we need the deepest match, which is the actual leaf.
 */
export function findCurrentNode(
  tree: TreeNodeView,
): TreeNodeView | null {
  // Try to find a deeper current node among children first
  for (const child of tree.children ?? []) {
    const found = findCurrentNode(child);
    if (found) return found;
  }
  // No deeper current node — if this node is current, it's the leaf
  if (tree.isCurrent) return tree;
  return null;
}

/**
 * Check if `nodeId` is the same as or a descendant of `ancestorId`.
 * Uses findNode to search the ancestor's subtree for nodeId.
 */
export function isDescendantOf(
  tree: TreeNodeView,
  nodeId: string,
  ancestorId: string,
): boolean {
  const ancestor = findNode(tree, ancestorId);
  if (!ancestor) return false;
  return findNode(ancestor, nodeId) !== null;
}

/**
 * Find an **unused** placeholder child (status="placeholder", no children)
 * at the given node. Placeholders are created by `branchAt` during fork
 * operations. Once a placeholder acquires children it has been consumed
 * and should not be reused — a new branch sibling should be created instead.
 */
export function findPlaceholderChild(
  tree: TreeNodeView,
  parentId: string,
): TreeNodeView | null {
  const parent = findNode(tree, parentId);
  if (!parent) return null;
  return parent.children?.find(
    (c) => c.status === "placeholder" && (!c.children || c.children.length === 0),
  ) ?? null;
}

/**
 * Find the deepest leaf reachable from `viewNodeId` by following
 * the first child at each level. Used to position the SDK's leaf
 * pointer at the correct branch tip before sending a message.
 */
export function findDeepestLeaf(
  tree: TreeNodeView,
  viewNodeId: string,
): string {
  let current = findNode(tree, viewNodeId);
  if (!current) return viewNodeId;

  while (current.children && current.children.length > 0) {
    current = current.children[0];
  }
  return current.id;
}

/**
 * Check whether sending from `viewNodeId` should auto-branch because
 * the scope's subtree already contains a fork (2+ children at some AI node).
 *
 * Walks deeper through single-child chains (user→AI→user→AI…) to find
 * the actual fork, even when viewNodeId is a grandparent.
 *
 * Returns the fork's AI node ID + optional unused placeholder ID.
 * Returns null branchId when the subtree is purely linear.
 */
export function needsAutoBranch(
  tree: TreeNodeView,
  viewNodeId: string,
): { branchId: string | null; placeholderId?: string } {
  const startId = findBranchPoint(tree, viewNodeId);
  if (!startId) return { branchId: null };

  // Walk deeper through single-child chains to find the actual fork.
  let current = findNode(tree, startId);
  while (current) {
    const childCount = current.children?.length ?? 0;
    if (childCount >= 2) {
      const placeholder = findPlaceholderChild(tree, current.id);
      return { branchId: current.id, placeholderId: placeholder?.id };
    }
    if (childCount === 0) break;
    // Exactly 1 child — walk deeper
    const child = current.children![0];
    if (isAINode(child)) {
      current = child;
    } else {
      const aiChild = child.children?.find((c) => isAINode(c));
      current = aiChild ?? null;
    }
  }

  return { branchId: null };
}

// ─── Scope Message Collection ──────────────────────────────────────────────────

export type ContentMap = Map<
  string,
  { role: string; content: string; timestamp: string }
>;

export interface ScopeResult {
  messages: ChatMessage[];
  branches: BranchOption[];
  /** Full ancestor chain from root to current scope (exclusive). */
  parentContext: ChatMessage[];
}

/**
 * Collect messages and branches for a scoped view.
 *
 * Walks the linear chain from `viewNodeId` until a fork or leaf.
 * When the view starts inside a fork (user node whose parent AI has
 * multiple children), prepends the grandparent user→AI pair so the
 * user sees what question led to this branch.
 * If viewNodeId is an AI node, the parent user message is prepended
 * so the full user→AI pair is always visible.
 */
export function collectScopeMessages(
  tree: TreeNodeView,
  viewNodeId: string | null,
  contentMap: ContentMap,
): ScopeResult {
  const startNode = viewNodeId ? findNode(tree, viewNodeId) : tree;
  if (!startNode) return { messages: [], branches: [], parentContext: [] };

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

  // Build ancestor chain — messages from root to the scope's parent.
  // Excludes messages already in `messages` (which start from the view node).
  const parentContext: ChatMessage[] = [];
  if (viewNodeId) {
    const messageIds = new Set(messages.map((m) => m.id));
    const ancestors = collectAncestors(tree, startNode.id);
    for (const id of ancestors) {
      if (!messageIds.has(id)) {
        pushMessage(id, contentMap, parentContext);
      }
    }
  }

  return { messages, branches, parentContext };
}

/**
 * Collect all ancestor node IDs from root down to (but NOT including) `nodeId`.
 * Returns IDs in root→leaf order.
 */
function collectAncestors(
  tree: TreeNodeView,
  nodeId: string,
): string[] {
  const path: string[] = [];
  function dfs(node: TreeNodeView): boolean {
    if (node.id === nodeId) return true;
    for (const child of node.children ?? []) {
      if (dfs(child)) {
        path.unshift(node.id);
        return true;
      }
    }
    return false;
  }
  dfs(tree);
  return path;
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
    // Fork — 2+ children. Report all as branch cards.
    // Placeholder filtering is a UI concern (handled client-side).
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

// ─── Placeholder Stripping ──────────────────────────────────────────────────

/**
 * Remove placeholder nodes from the tree, hoisting their children up
 * to the parent level. This is used for UI-facing trees so that
 * internal fork scaffolding ("New branch") is invisible to the user.
 *
 * The branching logic operates on the raw tree (with placeholders) —
 * this function is only applied to the tree sent to the client.
 */
export function stripPlaceholders(tree: TreeNodeView): TreeNodeView {
  return {
    ...tree,
    children: flattenPlaceholderChildren(tree.children ?? []),
  };
}

function flattenPlaceholderChildren(children: TreeNodeView[]): TreeNodeView[] {
  const result: TreeNodeView[] = [];
  for (const child of children) {
    if (child.status === "placeholder") {
      // Hoist this placeholder's children up to the current level
      result.push(...flattenPlaceholderChildren(child.children ?? []));
    } else {
      result.push(stripPlaceholders(child));
    }
  }
  return result;
}
