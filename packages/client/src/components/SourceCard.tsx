import { useState, useRef, useEffect } from "react";
import type { SourceCardProps } from "@pi-tree/ui";
import { Tag, MoreHorizontal, RefreshCw, Zap, Settings } from "lucide-react";
import { getSourceTypeConfig, resolveCardSubtitle } from "../source-types.js";
import { useNavigate } from "react-router";

export function SourceCard({
  source,
  onClick,
  onTagClick,
  renderCover,
  onUpdateSource,
  onReprocessSource,
}: SourceCardProps) {
  const navigate = useNavigate();
  const typeConfig = getSourceTypeConfig(source.type);
  const TypeIcon = typeConfig.icon;

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
      className="source-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {renderCover()}

      <div className="source-card-body">
        <div className="source-card-info">
          <span className="source-card-type-icon" title={typeConfig.label}>
            <TypeIcon size={14} />
          </span>
          <h3 className="source-card-title">{source.title}</h3>
          <p className="source-card-author">{resolveCardSubtitle(typeConfig.cardSubtitle, source as unknown as Record<string, unknown>)}</p>
        </div>

        {/* Badges from source type config */}
        {typeConfig.badges && typeConfig.badges.length > 0 && (
          <div className="source-card-badges">
            {typeConfig.badges.map((badge) => {
              const src = source as unknown as Record<string, unknown>;
              const meta = (src.metadata ?? {}) as Record<string, unknown>;
              const val = meta[badge.field] ?? src[badge.field];
              if (!val) return null;
              if (badge.value && String(val) !== badge.value) return null;
              const label = typeof val === "number" ? `${val} ${badge.label}` : badge.label;
              return (
                <span
                  key={badge.field}
                  className="source-card-badge"
                  style={{ background: badge.color }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Tags */}
      {source.tags && source.tags.length > 0 && (
        <div className="source-card-tags">
          {source.tags.map((tag) => (
            <span key={tag} className="source-card-tag" onClick={(e) => { e.stopPropagation(); onTagClick(); }}>{tag}</span>
          ))}
        </div>
      )}

      <button
        className="source-card-tag-btn"
        onClick={(e) => { e.stopPropagation(); onTagClick(); }}
        title="Manage tags"
      >
        <Tag size={14} />
      </button>
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
            <button
              className="source-card-dropdown-item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                navigate(`/source/${source.id}/sessions`);
              }}
            >
              <Settings size={14} />
              Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
