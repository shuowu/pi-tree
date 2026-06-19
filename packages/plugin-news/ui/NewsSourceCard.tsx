import type { SourceCardProps } from "@pi-tree/ui";
import { Newspaper, Tag, Rss } from "lucide-react";

export function NewsSourceCard({ source, onClick, onTagClick, renderCover }: SourceCardProps) {
  return (
    <div
      className="source-card news-source-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {renderCover("sm")}
      <div className="source-card-info">
        <div className="source-card-title">
          <span className="source-card-type-icon">
            <Newspaper size={14} />
          </span>
          {source.title}
        </div>
        <div className="source-card-author">
          {source.author || "RSS Feed Aggregator"}
        </div>
        
        {/* News-specific badge or descriptor */}
        <div className="source-card-news-meta" style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "4px", 
          fontSize: "11px", 
          color: "var(--text-secondary, #666)", 
          marginTop: "6px" 
        }}>
          <Rss size={10} style={{ color: "var(--accent, #6c5ce7)" }} />
          <span>Multi-feed reader dashboard</span>
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
              {source.status === "processing" ? "Refreshing..." : "Queued"}
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
