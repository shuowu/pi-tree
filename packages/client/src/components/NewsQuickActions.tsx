import { Newspaper, TrendingUp, Search } from "lucide-react";
import { useState } from "react";
import "./NewsQuickActions.css";

interface NewsQuickActionsProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

export function NewsQuickActions({ onSendMessage, isLoading }: NewsQuickActionsProps) {
  const [showScan, setShowScan] = useState(false);
  const [scanKeyword, setScanKeyword] = useState("");

  const handleScan = () => {
    if (!scanKeyword.trim()) return;
    onSendMessage(`scan ${scanKeyword.trim()}`);
    setScanKeyword("");
    setShowScan(false);
  };

  return (
    <div className="news-quick-actions">
      <button
        className="news-quick-btn"
        onClick={() => onSendMessage("Give me a comprehensive overview of today's news and trending topics.")}
        disabled={isLoading}
        title="Get today's news overview"
      >
        <Newspaper size={14} />
        Overview
      </button>
      <button
        className="news-quick-btn"
        onClick={() => onSendMessage("Analyze trends across all feeds from the past 72 hours. What topics are gaining momentum?")}
        disabled={isLoading}
        title="Analyze 72h trends"
      >
        <TrendingUp size={14} />
        Trends
      </button>
      {showScan ? (
        <div className="news-scan-input">
          <input
            type="text"
            placeholder="Keyword..."
            value={scanKeyword}
            onChange={(e) => setScanKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleScan();
              if (e.key === "Escape") { setShowScan(false); setScanKeyword(""); }
            }}
            autoFocus
          />
          <button onClick={handleScan} disabled={!scanKeyword.trim()}>
            Go
          </button>
          <button onClick={() => { setShowScan(false); setScanKeyword(""); }}>
            ✕
          </button>
        </div>
      ) : (
        <button
          className="news-quick-btn"
          onClick={() => setShowScan(true)}
          disabled={isLoading}
          title="Search for a topic"
        >
          <Search size={14} />
          Scan
        </button>
      )}
    </div>
  );
}
