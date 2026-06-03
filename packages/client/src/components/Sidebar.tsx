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

  return (
    <div className="tree-view">
      <TreeNode node={tree} onNavigate={onNavigate} depth={0} />
    </div>
  );
}

function TreeNode({
  node,
  onNavigate,
  depth,
}: {
  node: TreeNodeView;
  onNavigate: (nodeId: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const indent = depth * 16;

  return (
    <div className="tree-node">
      <div
        className={`tree-entry ${node.isCurrent ? "current" : ""} status-${node.status}`}
        style={{ paddingLeft: indent + 12 }}
        onClick={() => onNavigate(node.id)}
        role="button"
        tabIndex={0}
      >
        {hasChildren && (
          <span
            className={`tree-chevron ${expanded ? "expanded" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            ›
          </span>
        )}
        <span className={`tree-dot status-${node.status}`} />
        <span className="tree-label">{node.label}</span>
        {node.messageCount > 0 && (
          <span className="tree-count">{node.messageCount}</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="tree-children">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
