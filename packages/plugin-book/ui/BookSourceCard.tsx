import type { SourceCardProps } from "@pi-tree/ui";
import { BookOpen, Tag } from "lucide-react";

export function BookSourceCard({ source, onClick, onTagClick, renderCover }: SourceCardProps) {
  return (
    <div
      className="source-card book-source-card"
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
