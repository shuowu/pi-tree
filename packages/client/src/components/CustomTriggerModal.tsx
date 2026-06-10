import { useEffect, useState } from "react";
import { X, Info } from "lucide-react";
import { fetchNewsFeeds, type ClientFeedConfig } from "../api";
import "./CustomTriggerModal.css";

interface CustomTriggerModalProps {
  onClose: () => void;
  onSave: (trigger: {
    id: string;
    title: string;
    type: "overview" | "trends" | "scan";
    keyword?: string;
    feeds: string[];
    tags: string[];
  }) => void;
}

export function CustomTriggerModal({ onClose, onSave }: CustomTriggerModalProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"overview" | "trends" | "scan">("overview");
  const [keyword, setKeyword] = useState("");
  const [feeds, setFeeds] = useState<ClientFeedConfig[]>([]);
  const [selectedFeeds, setSelectedFeeds] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNewsFeeds()
      .then((data) => {
        setFeeds(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load news feeds", err);
        setLoading(false);
      });
  }, []);

  // Get unique tags across all feeds
  const allTags = Array.from(
    new Set(feeds.flatMap((f) => f.tags))
  ).sort();

  const handleToggleFeed = (feedId: string) => {
    setSelectedFeeds((prev) =>
      prev.includes(feedId) ? prev.filter((id) => id !== feedId) : [...prev, feedId]
    );
  };

  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    onSave({
      id: `custom-${Date.now()}`,
      title: title.trim(),
      type,
      keyword: type === "scan" ? keyword.trim() : undefined,
      feeds: selectedFeeds,
      tags: selectedTags,
    });
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="custom-trigger-overlay" onClick={onClose}>
      <div className="custom-trigger-modal" onClick={(e) => e.stopPropagation()}>
        <header className="custom-trigger-header">
          <h2>Create News Trigger</h2>
          <button className="custom-trigger-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="custom-trigger-form">
          <div className="form-group">
            <label htmlFor="trigger-title">Trigger Title</label>
            <input
              id="trigger-title"
              type="text"
              placeholder="e.g., AI Deep Dives, Tech Trends..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Action Type</label>
            <div className="radio-group">
              <label className={`radio-label ${type === "overview" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="trigger-type"
                  value="overview"
                  checked={type === "overview"}
                  onChange={() => setType("overview")}
                />
                Overview
              </label>
              <label className={`radio-label ${type === "trends" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="trigger-type"
                  value="trends"
                  checked={type === "trends"}
                  onChange={() => setType("trends")}
                />
                Trends
              </label>
              <label className={`radio-label ${type === "scan" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="trigger-type"
                  value="scan"
                  checked={type === "scan"}
                  onChange={() => setType("scan")}
                />
                Scan
              </label>
            </div>
          </div>

          {type === "scan" && (
            <div className="form-group">
              <label htmlFor="trigger-keyword">Keyword to Scan</label>
              <input
                id="trigger-keyword"
                type="text"
                placeholder="e.g., LLM, OpenAI, quantum..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                required
              />
            </div>
          )}

          <div className="filter-sections">
            <div className="filter-section">
              <label>Filter by Tags</label>
              {loading ? (
                <div className="filter-loading">Loading tags...</div>
              ) : allTags.length === 0 ? (
                <div className="filter-empty">No tags found.</div>
              ) : (
                <div className="checkbox-list">
                  {allTags.map((tag) => (
                    <label key={tag} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(tag)}
                        onChange={() => handleToggleTag(tag)}
                      />
                      #{tag}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="filter-section">
              <label>Filter by Feeds</label>
              {loading ? (
                <div className="filter-loading">Loading feeds...</div>
              ) : feeds.length === 0 ? (
                <div className="filter-empty">No feeds configured.</div>
              ) : (
                <div className="checkbox-list">
                  {feeds.map((feed) => (
                    <label key={feed.id} className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedFeeds.includes(feed.id)}
                        onChange={() => handleToggleFeed(feed.id)}
                      />
                      {feed.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="custom-trigger-info">
            <Info size={14} />
            <span>
              Pi will automatically apply these filters to search and aggregate tools when this trigger runs.
            </span>
          </div>

          <footer className="custom-trigger-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-save" disabled={!title.trim() || loading}>
              Create Trigger
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
