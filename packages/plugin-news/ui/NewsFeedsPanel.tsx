import { useEffect, useState } from "react";
import { ArrowLeft, Rss, ChevronRight } from "lucide-react";
import type { SourceItemsPanelProps } from "@pi-tree/ui";
import { NewsItemListView } from "./NewsItemListView.js";
import "./NewsItemsPanel.css";
import "./NewsFeedsPanel.css";

interface FeedConfig {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

/**
 * Feeds tab — browse configured feeds and drill into one feed's items.
 * Uses a longer lookback than the Latest tab since single feeds (especially
 * infrequent YouTube channels) post sparsely.
 */
export function NewsFeedsPanel({ userId, onOpenSource }: SourceItemsPanelProps) {
  const [feeds, setFeeds] = useState<FeedConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/news/feeds");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: FeedConfig[] = await res.json();
        if (cancelled) return;
        setFeeds([...data].sort((a, b) => a.name.localeCompare(b.name)));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load feeds");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="news-items-panel"><div className="nip-empty">Loading feeds…</div></div>;
  }

  if (selected) {
    return (
      <div className="news-items-panel">
        <div className="nfp2-header">
          <button className="nfp2-back" onClick={() => setSelected(null)}>
            <ArrowLeft size={14} /> Feeds
          </button>
          <span className="nfp2-current">{selected.name}</span>
          {selected.tags.map((tag) => (
            <span key={tag} className="nip-feed-tag nfp2-tag">#{tag}</span>
          ))}
        </div>
        <NewsItemListView
          userId={userId}
          onOpenSource={onOpenSource}
          feedId={selected.id}
          days={90}
        />
      </div>
    );
  }

  return (
    <div className="news-items-panel">
      {error && <div className="nip-error">{error}</div>}
      {feeds.length === 0 ? (
        <div className="nip-empty">No feeds configured.</div>
      ) : (
        <ul className="nfp2-list">
          {feeds.map((feed) => (
            <li key={feed.id}>
              <button className="nfp2-feed" onClick={() => setSelected(feed)}>
                <Rss size={14} className="nfp2-icon" />
                <span className="nfp2-name">{feed.name}</span>
                <span className="nfp2-tags">
                  {feed.tags.map((tag) => (
                    <span key={tag} className="nip-feed-tag nfp2-tag">#{tag}</span>
                  ))}
                </span>
                <ChevronRight size={14} className="nfp2-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
