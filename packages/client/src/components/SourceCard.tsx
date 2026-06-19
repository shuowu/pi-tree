import type { SourceCardProps } from "@pi-tree/ui";
import { Tag } from "lucide-react";
import { getSourceTypeConfig, resolveCardSubtitle } from "../source-types.js";

export function SourceCard({ source, onClick, onTagClick, renderCover }: SourceCardProps) {
  const typeConfig = getSourceTypeConfig(source.type);
  const TypeIcon = typeConfig.icon;

  return (
    <div
      className="source-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {renderCover("sm")}
      <div className="source-card-info">
        <div className="source-card-title">
          <span className="source-card-type-icon">
            <TypeIcon size={14} />
          </span>
          {source.title}
        </div>
        <div className="source-card-author">
          {resolveCardSubtitle(
            typeConfig.cardSubtitle,
            source as unknown as Record<string, unknown>,
          )}
        </div>
        <div className="source-card-badges">
          {source.tags?.map((tag) => (
            <span key={tag} className="badge badge-tag">
              {tag}
            </span>
          ))}
          {typeConfig.badges?.map((badge) => {
            const fieldVal = (source as Record<string, unknown>)[badge.field];
            const show = badge.value ? fieldVal === badge.value : !!fieldVal;
            if (!show) return null;
            return (
              <span
                key={`${badge.field}-${badge.value ?? ""}`}
                className={`badge badge-${badge.color}`}
              >
                {badge.label}
              </span>
            );
          })}
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
      {/* Tag button */}
      <button
        className="source-card-tag-btn"
        onClick={(e) => {
          e.stopPropagation();
          onTagClick();
        }}
        title="Manage tags"
      >
        <Tag size={14} />
      </button>
    </div>
  );
}
