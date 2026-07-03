/**
 * Hook for @-mention autocomplete in RouterChat and SpotlightSearch.
 *
 * Fetches sources and news feeds, synthesizes a flat list of
 * mention suggestions with four kinds:
 *   - category → All Books, All News (type-level scope)
 *   - source   → @SourceTitle
 *   - feed     → @News:FeedName
 *   - tag      → @News#tagname
 */
import { useState, useCallback, useRef } from "react";
import type { Source } from "@pi-tree/shared";
import { fetchSources, fetchNewsFeeds, type ClientFeedConfig } from "../api";
import { getSourceTypeConfig } from "../source-types";
import { filterMentionItems } from "./mention-filter.js";
import type { MentionSuggestion } from "./mention-filter.js";

// Re-export pure functions and types for existing consumers
export { filterMentionItems, parseMentionQuery } from "./mention-filter.js";
export type { MentionSuggestion } from "./mention-filter.js";

/** Re-fetch if data is stale (5 min) so newly added feeds/tags appear */
const STALE_MS = 5 * 60 * 1000;

/**
 * Fetches and caches sources + news feeds for @-mention autocomplete.
 */
export function useSourceMentions() {
  const [allItems, setAllItems] = useState<MentionSuggestion[]>([]);
  const loadedRef = useRef(false);
  const loadedAtRef = useRef(0);

  // Lazy-load sources + feeds on first trigger (retries on failure)
  const ensureLoaded = useCallback(async () => {
    const now = Date.now();
    if (loadedRef.current && now - loadedAtRef.current < STALE_MS) return;
    loadedRef.current = true; // prevent concurrent fetches
    try {
      let feedsFailed = false;
      const [sources, feeds] = await Promise.all([
        fetchSources().catch(() => [] as Source[]),
        fetchNewsFeeds().catch(() => { feedsFailed = true; return [] as ClientFeedConfig[]; }),
      ]);

      // If feeds fetch failed (transient 500), render sources-only but allow retry
      if (feedsFailed) {
        loadedRef.current = false;
      }

      const items: MentionSuggestion[] = [];

      // Sources (filter out the internal "router" source)
      for (const s of sources) {
        if ((s.type as string) === "router") continue;
        items.push({
          id: `source-${s.id}`,
          label: s.title,
          sublabel: s.author,
          type: s.type,
          kind: "source",
          insertText: `@${s.title}`,
        });
      }

      // News feeds → @News:FeedName
      for (const f of feeds) {
        items.push({
          id: `feed-${f.id}`,
          label: `News · ${f.name}`,
          sublabel: f.tags.length > 0 ? f.tags.join(", ") : undefined,
          type: "news",
          kind: "feed",
          insertText: `@News:${f.name}`,
        });
      }

      // News tags → @News#tag  (deduplicated, with feed count)
      const tagCounts = new Map<string, number>();
      for (const f of feeds) {
        for (const tag of f.tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
      for (const [tag, count] of tagCounts) {
        items.push({
          id: `tag-${tag}`,
          label: `News #${tag}`,
          sublabel: `${count} feed${count > 1 ? "s" : ""}`,
          type: "news",
          kind: "tag",
          insertText: `@News#${tag}`,
        });
      }

      // Type-level categories — "All Books", "All News", etc.
      const typeCounts = new Map<string, number>();
      for (const s of sources) {
        if ((s.type as string) === "router") continue;
        typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
      }

      const categories: MentionSuggestion[] = [];
      for (const [type, count] of typeCounts) {
        if (count < 1) continue; // skip if only 1 — direct source is enough
        const typeConfig = getSourceTypeConfig(type);
        categories.push({
          id: `category-${type}`,
          label: `All ${typeConfig.label}s`,
          sublabel: `${count} source${count > 1 ? "s" : ""}`,
          type,
          kind: "category",
          insertText: `@${type}`,
        });
      }

      setAllItems([...categories, ...items]);
      loadedAtRef.current = now;
    } catch {
      // Silently fail — but allow retry on next @
      loadedRef.current = false;
    }
  }, []);

  /** Filter items by query — multi-word AND matching.
   *  Each space-separated word must appear somewhere in label, sublabel, or insertText.
   *  e.g. "ne ai" matches "News #ai" because "ne" ⊂ "News" AND "ai" ⊂ "#ai". */
  const filterItems = useCallback(
    (query: string): MentionSuggestion[] => filterMentionItems(allItems, query),
    [allItems],
  );

  return { ensureLoaded, filterItems, allItems };
}
