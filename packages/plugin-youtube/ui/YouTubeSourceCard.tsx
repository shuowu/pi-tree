import type { SourceCardProps } from "@pi-tree/ui";
import { Tag, Play } from "lucide-react";
import "./YouTubeSourceCard.css";

function formatViews(views?: any): string {
  if (views === undefined || views === null) return "";
  const num = typeof views === "number" ? views : parseInt(String(views).replace(/,/g, ""), 10);
  if (isNaN(num)) return String(views);
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B views`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K views`;
  }
  return `${num} ${num === 1 ? "view" : "views"}`;
}

function formatPublishDate(dateStr?: any): string {
  if (!dateStr) return "";
  const str = String(dateStr);
  if (str.includes("ago") || str.includes("today") || str.includes("yesterday")) {
    return str;
  }
  const date = new Date(str);
  if (isNaN(date.getTime())) return str;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return str;
  if (diffDays < 1) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} ${diffMonths === 1 ? "month" : "months"} ago`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} ${diffYears === 1 ? "year" : "years"} ago`;
}

export function YouTubeSourceCard({ source, onClick, onTagClick, renderCover }: SourceCardProps) {
  const meta = source.metadata;
  const lengthSeconds = typeof meta?.lengthSeconds === "number" ? meta.lengthSeconds : 0;
  
  // Format duration helper (e.g. 5:23 or 1:04:12)
  let durationStr = "";
  if (lengthSeconds > 0) {
    const h = Math.floor(lengthSeconds / 3600);
    const m = Math.floor((lengthSeconds % 3600) / 60);
    const s = lengthSeconds % 60;
    if (h > 0) {
      durationStr = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    } else {
      durationStr = `${m}:${String(s).padStart(2, "0")}`;
    }
  }

  return (
    <div
      className="source-card youtube-source-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="youtube-cover-wrapper">
        {renderCover("sm")}
        <div className="youtube-play-overlay">
          <div className="youtube-play-btn">
            <Play size={18} fill="currentColor" />
          </div>
        </div>
        {durationStr && (
          <span className="youtube-duration-overlay" style={{
            position: "absolute",
            bottom: "6px",
            right: "6px",
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            color: "#fff",
            padding: "2px 6px",
            borderRadius: "4px",
            fontSize: "10px",
            fontWeight: "bold",
            pointerEvents: "none",
            zIndex: 6
          }}>
            {durationStr}
          </span>
        )}
      </div>

      <div className="source-card-info">
        <div className="source-card-title">
          {source.title}
        </div>
        <div className="source-card-author">
          {source.author || "YouTube Creator"}
        </div>
        
        <div className="youtube-card-metadata">
          {meta?.viewCount !== undefined && (
            <span className="separator">
              {formatViews(meta.viewCount)}
            </span>
          )}
          {meta?.publishDate ? (
            <span>
              {formatPublishDate(meta.publishDate)}
            </span>
          ) : null}
        </div>

        <div className="source-card-badges">
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

