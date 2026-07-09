import { useState, useRef, useEffect } from "react";
import type { SourceCardProps } from "@pi-tree/ui";
import { BookOpen, Tag, MoreHorizontal, RefreshCw, Zap, CheckCircle2, Circle } from "lucide-react";

export function BookSourceCard({
  source,
  onClick,
  onTagClick,
  renderCover,
  onUpdateSource,
  onReprocessSource,
  onToggleFinished,
}: SourceCardProps) {
  const isFinished = source.metadata?.finished === true;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      className={`source-card book-source-card${menuOpen ? " menu-open" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {renderCover("sm")}
      <div className="source-card-info">
        <div className="source-card-title">
          <span className="source-card-type-icon">
            <BookOpen size={14} />
          </span>
          {source.title}
        </div>
        <div className="source-card-author">
          {source.author}
          {source.year ? ` (${source.year})` : ""}
        </div>

        <div className="source-card-badges" style={{ marginTop: "8px" }}>
          {isFinished && (
            <span className="badge badge-green source-card-finished-badge">
              <CheckCircle2 size={11} />
              Finished
            </span>
          )}
          {source.tags?.map((tag) => (
            <span key={tag} className="badge badge-tag">
              {tag}
            </span>
          ))}
          {source.status === "failed" && (
            <span className="badge badge-red">Failed</span>
          )}
          {(source.status === "pending" || source.status === "processing") && (
            <span
              className="badge badge-blue animate-pulse"
              style={{ animation: "pulse 1.5s ease-in-out infinite" }}
            >
              {source.status === "processing" ? "Processing..." : "Queued"}
            </span>
          )}
        </div>
      </div>
      {/* More actions menu */}
      <div className="source-card-menu" ref={menuRef}>
        <button
          className="source-card-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
          title="More actions"
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div className="source-card-dropdown">
            {onToggleFinished && (
              <button
                className="source-card-dropdown-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onToggleFinished();
                }}
              >
                {isFinished ? <Circle size={14} /> : <CheckCircle2 size={14} />}
                {isFinished ? "Mark as unfinished" : "Mark as finished"}
              </button>
            )}
            <button
              className="source-card-dropdown-item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onTagClick();
              }}
            >
              <Tag size={14} />
              Manage tags
            </button>
            {onUpdateSource && (
              <button
                className="source-card-dropdown-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onUpdateSource();
                }}
              >
                <RefreshCw size={14} />
                Update Analysis
              </button>
            )}
            {onReprocessSource && (
              <button
                className="source-card-dropdown-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onReprocessSource();
                }}
              >
                <Zap size={14} />
                Re-process
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
