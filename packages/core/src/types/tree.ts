/**
 * Core tree and session types for pi-tree.
 *
 * These types define the tree-structured conversation model.
 * They are independent of any database or app-specific concepts.
 */

// ---------------------------------------------------------------------------
// Tree Node View — client-facing tree structure
// ---------------------------------------------------------------------------

export interface TreeNodeView {
  id: string;
  parentId: string | null;
  label: string;
  status: "active" | "completed" | "abandoned";
  messageCount: number;
  summary?: string;
  children: TreeNodeView[];
  /** Whether this is the currently active node */
  isCurrent: boolean;
}

// ---------------------------------------------------------------------------
// Chat Message — individual message in a conversation
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Timestamp ISO string */
  timestamp: string;
  /** If this message triggered a branch, the new node id */
  branchedToNodeId?: string;
}

// ---------------------------------------------------------------------------
// Branch & Breadcrumb — navigation types
// ---------------------------------------------------------------------------

export interface BranchOption {
  nodeId: string;
  label: string;
  messageCount: number;
  status: "active" | "completed" | "abandoned";
}

export interface BreadcrumbItem {
  nodeId: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Content Anchor — linking tree nodes to source content
// ---------------------------------------------------------------------------

export interface ContentAnchor {
  /** Line range in the markdown file (from the outline's navigation map) */
  lineRange: [start: number, end: number];
  /** The heading text from the outline */
  outlineHeading?: string;
}

// ---------------------------------------------------------------------------
// Session State — full state snapshot for a reading session
// ---------------------------------------------------------------------------

export interface SessionState {
  /** Database session ID — identifies which session within user+source */
  sessionId: number;
  userId: string;
  sourceId: string;
  activeNodeId: string;
  /** Which tree node the chat view is scoped to (null = root) */
  viewNodeId: string | null;
  breadcrumb: BreadcrumbItem[];
  /** Messages in the current scope (linear chain from viewNode to next fork) */
  messages: ChatMessage[];
  tree: TreeNodeView;
  /** Branches available at the end of the current chain (fork indicator) */
  branches: BranchOption[];
}
