import { useEffect, useState } from "react";
import type { SourceItemsPanelProps } from "@pi-tree/ui";
import { NewsItemListView } from "./NewsItemListView.js";
import "./NewsItemsPanel.css";

type TypeFilter = "all" | "news" | "youtube";

/**
 * Latest tab — the cross-feed item list with type (news/youtube) and
 * feed-tag filters. List rendering, pagination, and item actions live in
 * the shared NewsItemListView.
 */
export function NewsItemsPanel({ userId, onOpenSource }: SourceItemsPanelProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);

  // Feed tags for the filter bar (from feed config, so it's the complete list)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/news/feeds");
        if (!res.ok) return;
        const feeds: { tags: string[] }[] = await res.json();
        if (cancelled) return;
        setAllTags([...new Set(feeds.flatMap((f) => f.tags))].sort((a, b) => a.localeCompare(b)));
      } catch {
        // Filter bar just stays type-only
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="news-items-panel">
      <div className="nip-filters">
        <div className="nip-filter-group">
          {(["all", "news", "youtube"] as const).map((t) => (
            <button
              key={t}
              className={`nip-filter ${typeFilter === t ? "active" : ""}`}
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "All" : t === "news" ? "News" : "YouTube"}
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="nip-filter-group nip-filter-tags">
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`nip-filter ${tagFilter === tag ? "active" : ""}`}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <NewsItemListView
        userId={userId}
        onOpenSource={onOpenSource}
        itemTag={typeFilter === "all" ? undefined : typeFilter}
        feedTag={tagFilter ?? undefined}
        onFeedTagClick={(tag) => setTagFilter(tagFilter === tag ? null : tag)}
      />
    </div>
  );
}
