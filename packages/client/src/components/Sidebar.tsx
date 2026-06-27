import { useEffect, useRef, useState } from "react";
import { type TreeNodeView } from "@pi-tree/core/types";
import { GitBranch, HelpCircle, X, Trash2, Pencil } from "lucide-react";
import { buildTooltip } from "../utils/tree-utils";
import "./Sidebar.css";

/** Find a node's label by ID in the tree (DFS). */
function findNodeLabel(tree: TreeNodeView, nodeId: string): string | null {
  if (tree.id === nodeId) return tree.label;
  for (const child of tree.children ?? []) {
    const found = findNodeLabel(child, nodeId);
    if (found) return found;
  }
  return null;
}

interface SidebarProps {
  sourceId: string;
  tree: TreeNodeView | null;
  viewNodeId: string | null;
  /** Node IDs that have in-flight AI responses (show spinner) */
  generatingNodeIds: Set<string>;
  onNavigate: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onRenameNode?: (nodeId: string, newLabel: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ tree, viewNodeId, generatingNodeIds, onNavigate, onDeleteNode, onRenameNode, isOpen, onClose }: SidebarProps) {
  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`} data-testid="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-header-title">
          <GitBranch size={14} /> Session Tree
          <span className="sidebar-help-wrapper">
            <HelpCircle size={12} className="sidebar-help-icon" />
            <div className="sidebar-help-tooltip">
              <div className="sidebar-help-row"><span className="tree-dot" style={{ position: 'relative', top: 0, flexShrink: 0 }} /> Message node</div>
              <div className="sidebar-help-row"><span className="tree-dot" style={{ position: 'relative', top: 0, flexShrink: 0, background: 'var(--accent)', boxShadow: '0 0 4px var(--accent-glow)' }} /> Currently viewing</div>
              <div className="sidebar-help-row"><GitBranch size={10} className="tree-branch-icon" style={{ flexShrink: 0 }} /> Branch start</div>
              <div className="sidebar-help-row"><span className="sidebar-help-badge">⑂3</span> Fork point (3 branches)</div>
              <div className="sidebar-help-row"><span className="sidebar-help-chevron">›</span> Expand / collapse</div>
              <div className="sidebar-help-hint">Click any node to navigate. Right-click for options.</div>
            </div>
          </span>
        </span>
        <button className="sidebar-close" onClick={onClose} aria-label="Close panel" title="Close panel">
          <X size={14} />
        </button>
      </div>
      <div className="sidebar-content">
        <TreeView
          tree={tree}
          viewNodeId={viewNodeId}
          generatingNodeIds={generatingNodeIds}
          onNavigate={onNavigate}
          onDeleteNode={onDeleteNode}
          onRenameNode={onRenameNode}
        />
      </div>
    </aside>
  );
}

// ── Tree View (Session Tree) ──

function TreeView({
  tree,
  viewNodeId,
  generatingNodeIds,
  onNavigate,
  onDeleteNode,
  onRenameNode,
}: {
  tree: TreeNodeView | null;
  viewNodeId: string | null;
  generatingNodeIds: Set<string>;
  onNavigate: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onRenameNode?: (nodeId: string, newLabel: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; label: string } | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Close context menu on click anywhere or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

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

  const handleContextMenu = (e: React.MouseEvent, nodeId: string, label: string) => {
    // Don't show context menu for the root node
    if (nodeId === tree.id) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, label });
  };

  const handleDelete = () => {
    if (contextMenu && onDeleteNode) {
      onDeleteNode(contextMenu.nodeId);
      setContextMenu(null);
    }
  };

  const handleStartRename = () => {
    if (contextMenu) {
      setEditingNodeId(contextMenu.nodeId);
      // Strip the ✦ prefix for AI nodes so user edits the actual label
      const label = contextMenu.label;
      setEditValue(label.startsWith("✦ ") ? label.slice(2) : label);
      setContextMenu(null);
    }
  };

  /** Track whether the node being renamed is an AI node (✦ prefix) */
  const wasAINode = editingNodeId
    ? !!findNodeLabel(tree, editingNodeId)?.startsWith("✦")
    : false;

  const handleFinishRename = () => {
    if (editingNodeId && editValue.trim() && onRenameNode) {
      // Preserve ✦ prefix for AI nodes so isAINode() keeps working
      const newLabel = wasAINode
        ? `✦ ${editValue.trim()}`
        : editValue.trim();
      onRenameNode(editingNodeId, newLabel);
    }
    setEditingNodeId(null);
    setEditValue("");
  };

  const handleCancelRename = () => {
    setEditingNodeId(null);
    setEditValue("");
  };

  return (
    <div className="tree-view">
      <TreeNode
        node={tree}
        depth={0}
        viewNodeId={viewNodeId}
        generatingNodeIds={generatingNodeIds}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        onNavigate={onNavigate}
        onContextMenu={handleContextMenu}
        editingNodeId={editingNodeId}
        editValue={editValue}
        onEditChange={setEditValue}
        onEditFinish={handleFinishRename}
        onEditCancel={handleCancelRename}
        isBranchEntry={false}
      />
      {contextMenu && (
        <div
          className="tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onRenameNode && (
            <button className="tree-context-item" onClick={handleStartRename}>
              <Pencil size={12} />
              Rename
            </button>
          )}
          {onDeleteNode && (
            <button className="tree-context-item delete" onClick={handleDelete}>
              <Trash2 size={12} />
              Remove branch
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Recursive tree node renderer.
 * - Single child → render inline (no indent increase)
 * - Multiple children → indent and show branch indicators
 * - Collapsible branches
 * - Inline editing support for rename
 */
function TreeNode({
  node,
  depth,
  viewNodeId,
  generatingNodeIds,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onContextMenu,
  editingNodeId,
  editValue,
  onEditChange,
  onEditFinish,
  onEditCancel,
  isBranchEntry,
}: {
  node: TreeNodeView;
  depth: number;
  viewNodeId: string | null;
  generatingNodeIds: Set<string>;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onNavigate: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string, label: string) => void;
  editingNodeId: string | null;
  editValue: string;
  onEditChange: (value: string) => void;
  onEditFinish: () => void;
  onEditCancel: () => void;
  /** True when this node is a branch entry (parent has 2+ children) */
  isBranchEntry: boolean;
}) {
  const isAssistant = node.label.startsWith("✦");
  const isViewing = node.id === viewNodeId;
  const allChildren = node.children ?? [];
  const branchCount = allChildren.length;
  const hasBranches = branchCount > 1;
  const isCollapsed = collapsed.has(node.id);
  const isEditing = editingNodeId === node.id;
  const isGenerating = generatingNodeIds.has(node.id);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus edit input
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  return (
    <>
      <div
        className={[
          "tree-entry",
          isAssistant ? "assistant" : "user",
          node.isCurrent ? "current" : "",
          isViewing ? "viewing" : "",
          isEditing ? "editing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: depth * 16 + 12 }}
        onClick={() => !isEditing && onNavigate(node.id)}
        onContextMenu={(e) => onContextMenu(e, node.id, node.label)}
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
        {isBranchEntry && !isAssistant ? (
          <GitBranch size={10} className="tree-branch-icon" />
        ) : (
          <span className={`tree-dot${isGenerating ? " generating" : ""}`} />
        )}
        {isEditing ? (
          <input
            ref={editInputRef}
            className="tree-rename-input"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditFinish();
              if (e.key === "Escape") onEditCancel();
            }}
            onBlur={onEditFinish}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-label" title={buildTooltip(node)}>{node.label}</span>
        )}
        {hasBranches && !isEditing && (
          <span className="tree-branch-count">⑂{branchCount}</span>
        )}
      </div>

      {!isCollapsed &&
        (() => {
          const visibleChildren = (node.children ?? []).filter((child) =>
            // Hide unused placeholder nodes (pending ⑂ forks with no content yet)
            !(child.status === "placeholder" && (child.messageCount ?? 0) === 0),
          );
          const parentHasMultipleChildren = visibleChildren.length > 1;
          return visibleChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={allChildren.length > 1 ? depth + 1 : depth}
              viewNodeId={viewNodeId}
              generatingNodeIds={generatingNodeIds}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onNavigate={onNavigate}
              onContextMenu={onContextMenu}
              editingNodeId={editingNodeId}
              editValue={editValue}
              onEditChange={onEditChange}
              onEditFinish={onEditFinish}
              onEditCancel={onEditCancel}
              isBranchEntry={parentHasMultipleChildren}
            />
          ));
        })()}
    </>
  );
}
