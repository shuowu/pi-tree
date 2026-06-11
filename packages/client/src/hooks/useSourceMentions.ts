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

export interface MentionSuggestion {
  id: string;
  /** Display label in dropdown */
  label: string;
  /** Secondary text (author, feed tags, feed count) */
  sublabel?: string;
  /** Source type for icon selection */
  type: string;
  /** Discriminator: category / source / feed / tag */
  kind: "category" | "source" | "feed" | "tag";
  /** Text inserted into the input on selection (includes @) */
  insertText: string;
}

/**
 * Fetches and caches sources + news feeds for @-mention autocomplete.
 */
export function useSourceMentions() {
  const [allItems, setAllItems] = useState<MentionSuggestion[]>([]);
  const loadedRef = useRef(false);

  // Lazy-load sources + feeds on first trigger
  const ensureLoaded = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const [sources, feeds] = await Promise.all([
        fetchSources().catch(() => [] as Source[]),
        fetchNewsFeeds().catch(() => [] as ClientFeedConfig[]),
      ]);

      const items: MentionSuggestion[] = [];

      // Sources (filter out the internal "router" source)
      for (const s of sources) {
        if (s.type === "router") continue;
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
        if (s.type === "router") continue;
        typeCounts.set(s.type, (typeCounts.get(s.type) ?? 0) + 1);
      }

      const typeLabels: Record<string, string> = {
        book: "All Books",
        news: "All News",
        paper: "All Papers",
        podcast: "All Podcasts",
      };

      const categories: MentionSuggestion[] = [];
      for (const [type, count] of typeCounts) {
        if (count < 1) continue; // skip if only 1 — direct source is enough
        categories.push({
          id: `category-${type}`,
          label: typeLabels[type] ?? `All ${type}s`,
          sublabel: `${count} source${count > 1 ? "s" : ""}`,
          type,
          kind: "category",
          insertText: `@${type}`,
        });
      }

      setAllItems([...categories, ...items]);
    } catch {
      // Silently fail — mention autocomplete is non-critical
    }
  }, []);

  /** Filter items by query — multi-word AND matching.
   *  Each space-separated word must appear somewhere in label, sublabel, or insertText.
   *  e.g. "ne ai" matches "News #ai" because "ne" ⊂ "News" AND "ai" ⊂ "#ai". */
  const filterItems = useCallback(
    (query: string): MentionSuggestion[] => {
      if (!query) {
        // Show a balanced mix: categories first, then sources, feeds, tags
        const categories = allItems.filter((i) => i.kind === "category");
        const sources = allItems.filter((i) => i.kind === "source").slice(0, 5);
        const feeds = allItems.filter((i) => i.kind === "feed");
        const tags = allItems.filter((i) => i.kind === "tag");
        return [...categories, ...sources, ...feeds, ...tags].slice(0, 14);
      }
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length === 0) return allItems.slice(0, 12);
      return allItems
        .filter((item) => {
          const haystack = `${item.label} ${item.sublabel ?? ""} ${item.insertText}`.toLowerCase();
          return words.every((w) => haystack.includes(w));
        })
        .slice(0, 10);
    },
    [allItems],
  );

  return { ensureLoaded, filterItems, allItems };
}

/**
 * Parses the @-mention being actively edited at the cursor position.
 * Supports multiple @mentions — finds the one the cursor is inside.
 *
 * Examples:
 *  - "hello @pri|"                → { query: "pri", startIndex: 6 }
 *  - "@Dune compare with @Pri|"   → { query: "Pri", startIndex: 20 }
 *  - "@Dune| compare"             → { query: "Dune", startIndex: 0 }
 *  - "hello|"                     → null
 */
export function parseMentionQuery(
  text: string,
  cursorPos: number,
): { query: string; startIndex: number } | null {
  // Look backwards from cursor for the nearest @
  const beforeCursor = text.slice(0, cursorPos);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex === -1) return null;

  // @ must be at start of input or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(beforeCursor[atIndex - 1])) return null;

  const query = beforeCursor.slice(atIndex + 1);

  return { query, startIndex: atIndex };
}
