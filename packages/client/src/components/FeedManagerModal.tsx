import { useState, useEffect, useCallback } from "react";
import { X, Plus, Trash2, RefreshCw, Rss } from "lucide-react";
import "./FeedManagerModal.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedConfig {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

interface FeedManagerModalProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `HTTP error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeedManagerModal({ onClose }: FeedManagerModalProps) {
  const [feeds, setFeeds] = useState<FeedConfig[]>([]);
  const [syncing, setSyncing] = useState(false);

  // New feed form state
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newFeedTags, setNewFeedTags] = useState("");

  // -------------------------------------------------------------------------
  // Data loaders
  // -------------------------------------------------------------------------

  const loadFeeds = useCallback(async () => {
    try {
      const data = await apiFetch<FeedConfig[]>("/api/news/feeds");
      setFeeds(data);
    } catch (err: unknown) {
      console.error("Failed to load feeds:", err);
    }
  }, []);

  useEffect(() => {
    loadFeeds();
  }, [loadFeeds]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeedName || !newFeedUrl) return;

    try {
      const tagsArray = newFeedTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);

      const id = slugify(newFeedName);

      await apiFetch("/api/news/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: newFeedName,
          url: newFeedUrl,
          tags: tagsArray,
        }),
      });

      setNewFeedName("");
      setNewFeedUrl("");
      setNewFeedTags("");
      await loadFeeds();
    } catch (err: unknown) {
      alert(`Failed to add feed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDeleteFeed = async (id: string) => {
    if (!confirm("Are you sure you want to delete this feed subscription?"))
      return;
    try {
      await apiFetch(`/api/news/feeds/${id}`, { method: "DELETE" });
      await loadFeeds();
    } catch (err: unknown) {
      alert(
        `Failed to delete feed: ${err instanceof Error ? err.message : err}`,
      );
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await apiFetch("/api/news/crawl", { method: "POST" });
    } catch (err: unknown) {
      alert(`Sync failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSyncing(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="tag-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="feed-manager-modal">
        <button className="feed-manager-close" onClick={onClose}>
          <X size={16} />
        </button>

        <h2 className="feed-manager-title">
          <Rss size={18} /> Manage RSS Feeds
        </h2>
        <p className="feed-manager-hint">
          Add, remove, or sync your RSS feed subscriptions.
        </p>

        {/* Add Feed Form */}
        <form onSubmit={handleAddFeed} className="feed-manager-form">
          <input
            className="feed-manager-input"
            type="text"
            placeholder="Feed Name (e.g., Hacker News)"
            value={newFeedName}
            onChange={(e) => setNewFeedName(e.target.value)}
            required
          />
          <input
            className="feed-manager-input"
            type="url"
            placeholder="Feed URL (e.g., https://news.ycombinator.com/rss)"
            value={newFeedUrl}
            onChange={(e) => setNewFeedUrl(e.target.value)}
            required
          />
          <input
            className="feed-manager-input"
            type="text"
            placeholder="Tags (comma-separated, e.g. tech, ai)"
            value={newFeedTags}
            onChange={(e) => setNewFeedTags(e.target.value)}
          />
          <div className="feed-manager-actions">
            <button type="submit" className="feed-manager-btn-add">
              <Plus size={14} />
              Add Feed
            </button>
            <button
              type="button"
              className={`feed-manager-btn-sync${syncing ? " syncing" : ""}`}
              onClick={handleSyncAll}
              disabled={syncing}
              title="Crawl all feeds now"
            >
              <RefreshCw size={14} />
              {syncing ? "Syncing…" : "Sync All"}
            </button>
          </div>
        </form>

        {/* Feed List */}
        <span className="feed-manager-list-header">
          Active Subscriptions ({feeds.length})
        </span>
        <div className="feed-manager-list">
          {feeds.length === 0 && (
            <div className="feed-manager-empty">
              No feeds yet. Add one above to get started.
            </div>
          )}
          {feeds.map((feed) => (
            <div key={feed.id} className="feed-manager-item">
              <div className="feed-manager-item-info">
                <span className="feed-manager-item-name">{feed.name}</span>
                <span className="feed-manager-item-url" title={feed.url}>
                  {feed.url}
                </span>
                {feed.tags.length > 0 && (
                  <div className="feed-manager-item-tags">
                    {feed.tags.map((t) => (
                      <span key={t} className="feed-manager-tag">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="feed-manager-btn-delete"
                onClick={() => handleDeleteFeed(feed.id)}
                title="Delete Subscription"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
