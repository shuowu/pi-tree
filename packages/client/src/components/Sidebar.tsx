import { useEffect, useState } from "react";
import type { TreeNodeView, BookOutline, OutlineEntry } from "@pi-reader/shared";
import { fetchOutline } from "../api";
import "./Sidebar.css";

interface SidebarProps {
  bookId: string;
  tree: TreeNodeView | null;
  onNavigate: (nodeId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({ bookId, tree, onNavigate, isOpen, onToggle }: SidebarProps) {
  const [outline, setOutline] = useState<BookOutline | null>(null);
  const [activeTab, setActiveTab] = useState<"map" | "tree">("map");

  useEffect(() => {
    fetchOutline(bookId).then(setOutline).catch(() => {});
  }, [bookId]);

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
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            📑 Map
          </button>
          <button
            className={`sidebar-tab ${activeTab === "tree" ? "active" : ""}`}
            onClick={() => setActiveTab("tree")}
          >
            🌳 Tree
          </button>
        </div>

        <div className="sidebar-content">
          {activeTab === "map" && (
            <MapView outline={outline} />
          )}
          {activeTab === "tree" && (
            <TreeView tree={tree} onNavigate={onNavigate} />
          )}
        </div>
      </aside>
    </>
  );
}

// ── Map View (Book Outline) ──

function MapView({ outline }: { outline: BookOutline | null }) {
  if (!outline || outline.entries.length === 0) {
    return (
      <div className="sidebar-empty">
        <p>No outline available</p>
        <p className="sidebar-empty-hint">Generate one with the book-outline skill</p>
      </div>
    );
  }

  return (
    <div className="map-view">
      {outline.entries.map((entry, i) => (
        <OutlineNode key={i} entry={entry} />
      ))}
    </div>
  );
}

function OutlineNode({ entry }: { entry: OutlineEntry }) {
  const [expanded, setExpanded] = useState(entry.level <= 1);
  const hasChildren = entry.children && entry.children.length > 0;
  const indent = Math.max(0, entry.level - 1) * 16;

  return (
    <div className="outline-node">
      <div
        className={`outline-entry level-${entry.level}`}
        style={{ paddingLeft: indent + 12 }}
        onClick={() => hasChildren && setExpanded(!expanded)}
        role={hasChildren ? "button" : undefined}
      >
        {hasChildren && (
          <span className={`outline-chevron ${expanded ? "expanded" : ""}`}>
            ›
          </span>
        )}
        <span className="outline-indicator">░</span>
        <span className="outline-title">{entry.title}</span>
      </div>
      {expanded && hasChildren && (
        <div className="outline-children">
          {entry.children!.map((child, i) => (
            <OutlineNode key={i} entry={child} />
          ))}
        </div>
      )}
    </div>
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
