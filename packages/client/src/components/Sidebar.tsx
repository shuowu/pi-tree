import { type TreeNodeView } from "@pi-reader/shared";
import "./Sidebar.css";

interface SidebarProps {
  bookId: string;
  tree: TreeNodeView | null;
  onNavigate: (nodeId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ tree, onNavigate, isOpen, onToggle }: SidebarProps) {
  return (
    <>
      <button
        className={`sidebar-toggle ${isOpen ? "open" : ""}`}
        onClick={onToggle}
        aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isOpen ? "◁" : "▷"}
      </button>

      <aside className={`sidebar ${isOpen ? "open" : ""}`}>
        <div className="sidebar-header">🌳 Session Tree</div>
        <div className="sidebar-content">
          <TreeView tree={tree} onNavigate={onNavigate} />
        </div>
      </aside>
    </>
  );
}

// ── Tree View (Session Tree) ──

function TreeView({
  tree,
  onNavigate,
}: {
  tree: TreeNodeView | null;
  onNavigate: (nodeId: string) => void;
}) {
  if (!tree) {
    return (
      <div className="sidebar-empty">
        <p>No session tree yet</p>
        <p className="sidebar-empty-hint">Start chatting to build the tree</p>
      </div>
    );
  }

  // Flatten the tree into a visual list with branch-only indentation
  const flatNodes = flattenTree(tree, 0);

  return (
    <div className="tree-view">
      {flatNodes.map((item) => (
        <TreeEntry
          key={item.node.id}
          node={item.node}
          depth={item.depth}
          isBranchChild={item.isBranchChild}
          isLastBranch={item.isLastBranch}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

interface FlatItem {
  node: TreeNodeView;
  depth: number;
  isBranchChild: boolean;
  isLastBranch: boolean;
}

/**
 * Flatten a tree into a sequential list.
 * Only increase depth when a node has multiple children (a branch point).
 */
function flattenTree(node: TreeNodeView, depth: number): FlatItem[] {
  const items: FlatItem[] = [];

  // Add this node at current depth
  items.push({ node, depth, isBranchChild: false, isLastBranch: false });

  if (!node.children || node.children.length === 0) {
    return items;
  }

  if (node.children.length === 1) {
    // Linear: same depth, no indentation
    items.push(...flattenTree(node.children[0], depth));
  } else {
    // Branch point: indent children
    node.children.forEach((child, i) => {
      const childItems = flattenTree(child, depth + 1);
      // Mark the first item of each branch
      if (childItems.length > 0) {
        childItems[0].isBranchChild = true;
        childItems[0].isLastBranch = i === node.children!.length - 1;
      }
      items.push(...childItems);
    });
  }

  return items;
}

function TreeEntry({
  node,
  depth,
  isBranchChild,
  isLastBranch,
  onNavigate,
}: {
  node: TreeNodeView;
  depth: number;
  isBranchChild: boolean;
  isLastBranch: boolean;
  onNavigate: (nodeId: string) => void;
}) {
  const indent = depth * 20;
  const isAssistant = node.label.startsWith("✦");

  return (
    <div
      className={`tree-entry ${node.isCurrent ? "current" : ""} ${isAssistant ? "assistant" : "user"}`}
      style={{ paddingLeft: indent + 12 }}
      onClick={() => onNavigate(node.id)}
      role="button"
      tabIndex={0}
    >
      {isBranchChild && (
        <span className="tree-branch-indicator">
          {isLastBranch ? "└" : "├"}
        </span>
      )}
      <span className={`tree-dot status-${node.status}`} />
      <span className="tree-label">{node.label}</span>
      {node.messageCount > 0 && (
        <span className="tree-count">{node.messageCount}</span>
      )}
    </div>
  );
}
