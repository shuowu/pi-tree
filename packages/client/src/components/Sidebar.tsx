import { useState } from "react";
import { type TreeNodeView } from "@pi-reader/shared";
import "./Sidebar.css";

interface SidebarProps {
  bookId: string;
  tree: TreeNodeView | null;
  viewNodeId: string | null;
  onNavigate: (nodeId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ tree, viewNodeId, onNavigate, isOpen, onToggle }: SidebarProps) {
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
        <div className="sidebar-header">📑 Chapters</div>
        <div className="sidebar-content">
          <TreeView tree={tree} viewNodeId={viewNodeId} onNavigate={onNavigate} />
        </div>
      </aside>
    </>
  );
}

// ── Tree View (Chapters) ──

function TreeView({
  tree,
  viewNodeId,
  onNavigate,
}: {
  tree: TreeNodeView | null;
  viewNodeId: string | null;
  onNavigate: (nodeId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (!tree) {
    return (
      <div className="sidebar-empty">
        <p>No session tree yet</p>
        <p className="sidebar-empty-hint">Start chatting to build the tree</p>
      </div>
    );
  }

  const toggleCollapse = (nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  return (
    <div className="tree-view">
      <TreeNode
        node={tree}
        depth={0}
        viewNodeId={viewNodeId}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onNavigate={onNavigate}
        parentHasSiblings={false}
      />
    </div>
  );
}

/**
 * Recursive tree node renderer.
 * - Single child → render inline (no indent increase)
 * - Multiple children → indent and show branch indicators
 * - Collapsible branches
 */
function TreeNode({
  node,
  depth,
  viewNodeId,
  collapsed,
  onToggleCollapse,
  onNavigate,
  parentHasSiblings,
}: {
  node: TreeNodeView;
  depth: number;
  viewNodeId: string | null;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onNavigate: (id: string) => void;
  parentHasSiblings: boolean;
}) {
  const isAssistant = node.label.startsWith("✦");
  const isViewing = node.id === viewNodeId;
  const hasBranches = (node.children?.length ?? 0) > 1;
  const isCollapsed = collapsed.has(node.id);
  const childCount = node.children?.length ?? 0;

  return (
    <>
      <div
        className={[
          "tree-entry",
          isAssistant ? "assistant" : "user",
          node.isCurrent ? "current" : "",
          isViewing ? "viewing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: depth * 16 + 12 }}
        onClick={() => onNavigate(node.id)}
        role="button"
        tabIndex={0}
      >
        {hasBranches && (
          <button
            className={`tree-collapse ${isCollapsed ? "collapsed" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(node.id);
            }}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            ›
          </button>
        )}
        <span className={`tree-dot status-${node.status}`} />
        <span className="tree-label">{node.label}</span>
        {hasBranches && (
          <span className="tree-branch-count">⑂{childCount}</span>
        )}
      </div>

      {!isCollapsed &&
        node.children?.map((child, i) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={childCount > 1 ? depth + 1 : depth}
            viewNodeId={viewNodeId}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            onNavigate={onNavigate}
            parentHasSiblings={childCount > 1}
          />
        ))}
    </>
  );
}
