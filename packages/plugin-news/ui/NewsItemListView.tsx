import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileText, CirclePlay, ArrowRight } from "lucide-react";
import "./NewsItemsPanel.css";

export interface NewsItem {
  id: number;
  title: string;
  feedId: string;
  feedName: string;
  feedTags: string[];
  url: string;
  publishedAt: string | null;
  summary: string | null;
  author: string | null;
  tag: string;
  promotedSourceId: string | null;
}

interface ResolvedVideo {
  videoId: string;
  title: string;
  author: string;
  description: string;
  lengthSeconds: number;
  publishDate: string;
  viewCount: number;
  thumbnailUrl: string;
}

const PAGE_SIZE = 50;

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function postJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `${method} ${url} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface NewsItemListViewProps {
  userId: string;
  onOpenSource: (sourceId: string, opts?: { sessionId?: number; mode?: string }) => void;
  /** Filter by per-item tag (news/youtube) */
  itemTag?: string;
  /** Filter by a feed tag */
  feedTag?: string;
  /** Restrict to a single feed */
  feedId?: string;
  /** Lookback window in days (default 30) */
  days?: number;
  /** Row feed-tag chip clicks (chips render non-interactive when omitted) */
  onFeedTagClick?: (tag: string) => void;
}

/**
 * Shared paginated item list — fetching, re-tagging, and click-to-promote for
 * crawled news items. Hosted by the Latest tab (with filters) and the Feeds
 * tab (scoped to one feed).
 */
export function NewsItemListView({ userId, onOpenSource, itemTag, feedTag, feedId, days = 30, onFeedTagClick }: NewsItemListViewProps) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const buildQuery = useCallback((offset: number) => {
    const params = new URLSearchParams({
      days: String(days),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (itemTag) params.set("itemTag", itemTag);
    if (feedTag) params.set("tags", feedTag);
    if (feedId) params.set("feeds", feedId);
    return params.toString();
  }, [itemTag, feedTag, feedId, days]);

  // First page — refetches whenever a filter changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/news/items?${buildQuery(0)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: NewsItem[] = await res.json();
        if (cancelled) return;
        setItems(data);
        setHasMore(data.length === PAGE_SIZE);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load items");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/news/items?${buildQuery(items.length)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: NewsItem[] = await res.json();
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...data.filter((i) => !seen.has(i.id))];
      });
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, items.length, buildQuery]);

  const markPromoted = useCallback(async (item: NewsItem, sourceId: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, promotedSourceId: sourceId } : i)),
    );
    // Best-effort — an old remote crawler without the PATCH route shouldn't
    // block opening the session.
    try {
      await postJson(`/api/news/items/${item.id}`, "PATCH", { promotedSourceId: sourceId });
    } catch (err) {
      console.warn("[news-items] Failed to persist promoted link:", err);
    }
  }, []);

  const toggleTag = useCallback(async (item: NewsItem) => {
    const nextTag = item.tag === "youtube" ? "news" : "youtube";
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, tag: nextTag } : i)));
    try {
      await postJson(`/api/news/items/${item.id}`, "PATCH", { tag: nextTag });
    } catch (err) {
      // Revert on failure
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, tag: item.tag } : i)));
      setError(err instanceof Error ? err.message : "Failed to update tag");
    }
  }, []);

  const promoteAsArticle = useCallback(async (item: NewsItem) => {
    const created = await postJson<{ id: string }>("/api/library/sources/create", "POST", {
      title: item.title,
      author: item.feedName,
      type: "article",
      metadata: {
        url: item.url,
        feedId: item.feedId,
        feedName: item.feedName,
        publishedAt: item.publishedAt,
        summary: item.summary,
        rssItemId: item.id,
      },
    });
    const session = await postJson<{ id: number }>(
      `/api/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(created.id)}`,
      "POST",
      { title: item.title, context: { mode: "reading" } },
    );
    await markPromoted(item, created.id);
    onOpenSource(created.id, { sessionId: session.id, mode: "reading" });
  }, [userId, onOpenSource, markPromoted]);

  const promoteAsYoutube = useCallback(async (item: NewsItem) => {
    const res = await fetch(`/api/youtube/resolve?url=${encodeURIComponent(item.url)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `Failed to resolve video (${res.status})`);
    }
    const video: ResolvedVideo = await res.json();
    const created = await postJson<{ id: string }>("/api/library/sources/create", "POST", {
      title: video.title || item.title,
      author: video.author || item.feedName,
      type: "youtube",
      metadata: {
        videoId: video.videoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
        thumbnailUrl: video.thumbnailUrl,
        lengthSeconds: video.lengthSeconds,
        publishDate: video.publishDate,
        viewCount: video.viewCount,
        description: video.description,
      },
    });
    const session = await postJson<{ id: number }>(
      `/api/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(created.id)}`,
      "POST",
      { title: video.title || item.title, context: { mode: "watching" } },
    );
    await markPromoted(item, created.id);
    onOpenSource(created.id, { sessionId: session.id, mode: "watching" });
  }, [userId, onOpenSource, markPromoted]);

  const openItem = useCallback(async (item: NewsItem) => {
    if (pendingId !== null) return;

    if (item.promotedSourceId) {
      onOpenSource(item.promotedSourceId);
      return;
    }

    setPendingId(item.id);
    setError(null);
    try {
      if (item.tag === "youtube") {
        await promoteAsYoutube(item);
      } else {
        await promoteAsArticle(item);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setPendingId(null);
    }
  }, [pendingId, onOpenSource, promoteAsYoutube, promoteAsArticle]);

  if (loading) {
    return <div className="nip-empty">Loading items…</div>;
  }

  return (
    <>
      {error && <div className="nip-error">{error}</div>}
      {items.length === 0 ? (
        <div className="nip-empty">No items match in the last {days} days.</div>
      ) : (
        <>
          <ul className="nip-list">
            {items.map((item) => (
              <li key={item.id} className={`nip-item ${pendingId === item.id ? "pending" : ""}`}>
                <button
                  className={`nip-tag nip-tag-${item.tag}`}
                  title="Toggle news/youtube tag"
                  onClick={() => toggleTag(item)}
                >
                  {item.tag === "youtube" ? <CirclePlay size={12} /> : <FileText size={12} />}
                  {item.tag}
                </button>
                <button className="nip-title" onClick={() => openItem(item)} disabled={pendingId !== null}>
                  {item.title}
                  {item.promotedSourceId ? (
                    <span className="nip-open"><ArrowRight size={12} /> Open</span>
                  ) : pendingId === item.id ? (
                    <span className="nip-open">Starting…</span>
                  ) : null}
                </button>
                <span className="nip-meta">
                  {item.feedName}
                  {item.publishedAt && ` · ${relativeTime(item.publishedAt)}`}
                  {item.feedTags.map((tag) => (
                    <button
                      key={tag}
                      className="nip-feed-tag"
                      title={onFeedTagClick ? `Filter by #${tag}` : undefined}
                      disabled={!onFeedTagClick}
                      onClick={() => onFeedTagClick?.(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </span>
                <a
                  className="nip-link"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open original"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={13} />
                </a>
              </li>
            ))}
          </ul>
          {hasMore && (
            <button className="nip-load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </>
  );
}
