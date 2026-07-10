import { useState, useRef, useEffect, type ReactNode } from "react";
import type { Source } from "@pi-tree/shared";
import { Tag, MoreHorizontal, RefreshCw, Zap, CheckCircle2, Circle } from "lucide-react";

export interface SourceCardMenuProps {
  source: Source;
  /** Open the tag management modal */
  onTagClick: () => void;
  /** Trigger incremental analysis update (no force) */
  onUpdateSource?: () => void;
  /** Trigger full re-processing (force) */
  onReprocessSource?: () => void;
  /** Toggle the manual finished/done flag (stored in source.metadata.finished) */
  onToggleFinished?: () => void;
  /**
   * Notifies the card when the dropdown opens/closes so it can add the
   * "menu-open" class to its root (unclips overflow, raises z-index).
   */
  onOpenChange?: (open: boolean) => void;
  /** Extra menu items appended after the standard ones. Call close() before acting. */
  extraItems?: (close: () => void) => ReactNode;
}

/**
 * Standard "more actions" (⋯) dropdown for library source cards.
 *
 * Renders the shared action set — finished toggle, tag management, analysis
 * update, re-process — from whichever callbacks are provided, so plugin cards
 * get consistent behavior by composing this instead of re-implementing the menu.
 * Relies on the host app's global .source-card-menu/.source-card-dropdown styles.
 */
export function SourceCardMenu({
  source,
  onTagClick,
  onUpdateSource,
  onReprocessSource,
  onToggleFinished,
  onOpenChange,
  extraItems,
}: SourceCardMenuProps) {
  const isFinished = source.metadata?.finished === true;

  const [menuOpen, setMenuOpenState] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const setMenuOpen = (open: boolean) => {
    setMenuOpenState(open);
    onOpenChange?.(open);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const item = (
    icon: ReactNode,
    label: string,
    action: () => void,
  ) => (
    <button
      className="source-card-dropdown-item"
      onClick={(e) => {
        e.stopPropagation();
        setMenuOpen(false);
        action();
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="source-card-menu" ref={menuRef}>
      <button
        className="source-card-menu-btn"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(!menuOpen);
        }}
        title="More actions"
      >
        <MoreHorizontal size={16} />
      </button>
      {menuOpen && (
        <div className="source-card-dropdown">
          {onToggleFinished &&
            item(
              isFinished ? <Circle size={14} /> : <CheckCircle2 size={14} />,
              isFinished ? "Mark as unfinished" : "Mark as finished",
              onToggleFinished,
            )}
          {item(<Tag size={14} />, "Manage tags", onTagClick)}
          {onUpdateSource && item(<RefreshCw size={14} />, "Update Analysis", onUpdateSource)}
          {onReprocessSource && item(<Zap size={14} />, "Re-process", onReprocessSource)}
          {extraItems?.(() => setMenuOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Green "Finished" badge shown on cards whose source.metadata.finished is true */
export function FinishedBadge({ source }: { source: Source }) {
  if (source.metadata?.finished !== true) return null;
  return (
    <span className="badge badge-green source-card-finished-badge">
      <CheckCircle2 size={11} />
      Finished
    </span>
  );
}
