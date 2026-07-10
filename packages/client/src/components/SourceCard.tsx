import { useState } from "react";
import type { SourceCardProps } from "@pi-tree/ui";
import { SourceCardMenu, FinishedBadge } from "@pi-tree/ui";
import { Settings } from "lucide-react";
import { getSourceTypeConfig, resolveCardSubtitle } from "../source-types.js";
import { useNavigate } from "react-router";

export function SourceCard({
  source,
  onClick,
  onTagClick,
  renderCover,
  onUpdateSource,
  onReprocessSource,
  onToggleFinished,
}: SourceCardProps) {
  const navigate = useNavigate();
  const typeConfig = getSourceTypeConfig(source.type);
  const TypeIcon = typeConfig.icon;
  const isFinished = source.metadata?.finished === true;

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`source-card${menuOpen ? " menu-open" : ""}`}
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

        {/* Badges from source type config + finished status */}
        {(isFinished || (typeConfig.badges && typeConfig.badges.length > 0)) && (
          <div className="source-card-badges">
            <FinishedBadge source={source} />
            {(typeConfig.badges ?? []).map((badge) => {
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

      <SourceCardMenu
        source={source}
        onTagClick={onTagClick}
        onUpdateSource={onUpdateSource}
        onReprocessSource={onReprocessSource}
        onToggleFinished={onToggleFinished}
        onOpenChange={setMenuOpen}
        extraItems={(close) => (
          <button
            className="source-card-dropdown-item"
            onClick={(e) => {
              e.stopPropagation();
              close();
              navigate(`/source/${source.id}/sessions`);
            }}
          >
            <Settings size={14} />
            Settings
          </button>
        )}
      />
    </div>
  );
}
