import { useState } from "react";
import "./BookCover.css";

interface BookCoverProps {
  sourceId: string;
  title: string;
  author: string;
  hasCover?: boolean;
  sourceType?: string;
  size?: "sm" | "md" | "lg";
}

export function BookCover({ sourceId, title, author, hasCover, sourceType, size = "md" }: BookCoverProps) {
  const [imgError, setImgError] = useState(false);

  if (sourceType === "news") {
    return (
      <div
        className={`book-cover-container fallback-cover size-${size}`}
        style={{ background: "linear-gradient(135deg, #111827 0%, #1e40af 50%, #3b82f6 100%)" }}
      >
        <div className="fallback-cover-content">
          <div className="fallback-cover-header">
            <div className="fallback-cover-badge" style={{ backgroundColor: "#2563eb", color: "#ffffff" }}>📡 LIVE NEWS</div>
          </div>
          <div className="fallback-cover-title" style={{ fontSize: "1.2rem", fontWeight: "bold", letterSpacing: "-0.025em" }}>
            News & Trends
          </div>
          <div className="fallback-cover-divider" style={{ backgroundColor: "#2563eb" }} />
          <div className="fallback-cover-author">
            RSS Aggregator
          </div>
        </div>
        <div className="book-cover-spine-effect" />
      </div>
    );
  }

  // Generate deterministic gradient background based on book title
  const getBookGradient = (text: string) => {
    const gradients = [
      "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)", // Deep Navy
      "linear-gradient(135deg, #2b5876 0%, #4e4376 100%)", // Indigo/Purple
      "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)", // Slate/Teal
      "linear-gradient(135deg, #1f4037 0%, #99f2c8 100%)", // Forest/Mint
      "linear-gradient(135deg, #373b44 0%, #4286f4 100%)", // Steel Blue
      "linear-gradient(135deg, #8a2387 0%, #e94057 50%, #f27121 100%)", // Sunrise
      "linear-gradient(135deg, #6441a5 0%, #2a0845 100%)", // Deep Purple
      "linear-gradient(135deg, #41295a 0%, #2f0743 100%)", // Wine
      "linear-gradient(135deg, #000428 0%, #004e92 100%)", // Midnight Blue
      "linear-gradient(135deg, #43c6ac 0%, #191654 100%)", // Ocean Depth
    ];
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = text.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  };

  const showImageCover = hasCover && !imgError;
  const coverUrl = `/api/library/sources/${sourceId}/cover`;

  if (showImageCover) {
    return (
      <div className={`book-cover-container size-${size}`}>
        <img
          src={coverUrl}
          alt={`Cover of ${title}`}
          className="book-cover-img"
          onError={() => setImgError(true)}
          loading="lazy"
        />
        <div className="book-cover-spine-effect" />
      </div>
    );
  }

  // Fallback CSS Cover
  const gradient = getBookGradient(title);
  const cleanTitle = title.replace(/[_-]/g, " ").trim();
  const cleanAuthor = author.replace(/[_-]/g, " ").trim();

  return (
    <div
      className={`book-cover-container fallback-cover size-${size}`}
      style={{ background: gradient }}
    >
      <div className="fallback-cover-content">
        <div className="fallback-cover-header">
          <div className="fallback-cover-badge">PI LIBRARY</div>
        </div>
        <div className="fallback-cover-title" title={cleanTitle}>
          {cleanTitle}
        </div>
        <div className="fallback-cover-divider" />
        <div className="fallback-cover-author" title={cleanAuthor}>
          {cleanAuthor}
        </div>
      </div>
      <div className="book-cover-spine-effect" />
    </div>
  );
}
