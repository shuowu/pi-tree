import { useState, useCallback, useEffect } from "react";
import { Rss, ExternalLink } from "lucide-react";
import type { ContentPanelProps } from "@pi-tree/ui";
import "./NewsDashboardPanel.css";

interface FeedConfig {
  id: string;
  name: string;
  url: string;
  tags: string[];
  lastCrawledAt?: string;
  itemCount?: number;
}

/**
 * News content panel — shows configured feeds grouped by tag.
 * Feeds are clickable to scope the conversation to that feed/tag.
 */
export function NewsDashboardPanel({ onSendMessage }: ContentPanelProps) {
  const [feeds, setFeeds] = useState<FeedConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFeeds = useCallback(async () => {
    try {
      const res = await fetch("/api/news/feeds");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FeedConfig[] = await res.json();
      setFeeds(data);
    } catch (err) {
      console.error("Failed to load feeds:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeeds(); }, [loadFeeds]);

  // Group feeds by tag
  const tagGroups = new Map<string, FeedConfig[]>();
  const untagged: FeedConfig[] = [];

  for (const feed of feeds) {
    if (feed.tags.length === 0) {
      untagged.push(feed);
    } else {
      for (const tag of feed.tags) {
        const group = tagGroups.get(tag) ?? [];
        group.push(feed);
        tagGroups.set(tag, group);
      }
    }
  }

  // Sort tags alphabetically
  const sortedTags = Array.from(tagGroups.keys()).sort();

  const handleFeedClick = (feed: FeedConfig) => {
    onSendMessage?.(`What's new from ${feed.name}?`);
  };

  const handleTagClick = (tag: string) => {
    onSendMessage?.(`Give me an overview of ${tag} news`);
  };

  if (loading) {
    return (
      <div className="news-feeds-panel">
        <div className="nfp-loading">Loading feeds...</div>
      </div>
    );
  }

  return (
    <div className="news-feeds-panel">
      {/* Status bar */}
      <div className="nfp-status">
        <span className="nfp-status-count">
          <Rss size={12} />
          {feeds.length} feed{feeds.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Feeds by tag */}
      <div className="nfp-groups">
        {sortedTags.map((tag) => (
          <div key={tag} className="nfp-group">
            <button
              className="nfp-group-header"
              onClick={() => handleTagClick(tag)}
              title={`Ask about ${tag} news`}
            >
              <span className="nfp-tag">#{tag}</span>
              <span className="nfp-group-count">{tagGroups.get(tag)!.length}</span>
            </button>
            <div className="nfp-feed-list">
              {tagGroups.get(tag)!.map((feed) => (
                <button
                  key={feed.id}
                  className="nfp-feed"
                  onClick={() => handleFeedClick(feed)}
                  title={feed.url}
                >
                  <span className="nfp-feed-name">{feed.name}</span>
                  <ExternalLink size={10} className="nfp-feed-link" />
                </button>
              ))}
            </div>
          </div>
        ))}

        {untagged.length > 0 && (
          <div className="nfp-group">
            <div className="nfp-group-header">
              <span className="nfp-tag">Other</span>
              <span className="nfp-group-count">{untagged.length}</span>
            </div>
            <div className="nfp-feed-list">
              {untagged.map((feed) => (
                <button
                  key={feed.id}
                  className="nfp-feed"
                  onClick={() => handleFeedClick(feed)}
                  title={feed.url}
                >
                  <span className="nfp-feed-name">{feed.name}</span>
                  <ExternalLink size={10} className="nfp-feed-link" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
