import { describe, it, expect } from "vitest";
import {
  filterMentionItems,
  parseMentionQuery,
  type MentionSuggestion,
} from "../mention-filter";

// ---------------------------------------------------------------------------
// Helpers — build mention items without boilerplate
// ---------------------------------------------------------------------------

function makeCategory(type: string, count: number): MentionSuggestion {
  return {
    id: `category-${type}`,
    label: `All ${type}s`,
    sublabel: `${count} source${count > 1 ? "s" : ""}`,
    type,
    kind: "category",
    insertText: `@${type}`,
  };
}

function makeSource(id: string, title: string, type = "book"): MentionSuggestion {
  return {
    id: `source-${id}`,
    label: title,
    sublabel: "Author",
    type,
    kind: "source",
    insertText: `@${title}`,
  };
}

function makeFeed(id: string, name: string, tags: string[] = []): MentionSuggestion {
  return {
    id: `feed-${id}`,
    label: `News · ${name}`,
    sublabel: tags.length > 0 ? tags.join(", ") : undefined,
    type: "news",
    kind: "feed",
    insertText: `@News:${name}`,
  };
}

function makeTag(tag: string, feedCount: number): MentionSuggestion {
  return {
    id: `tag-${tag}`,
    label: `News #${tag}`,
    sublabel: `${feedCount} feed${feedCount > 1 ? "s" : ""}`,
    type: "news",
    kind: "tag",
    insertText: `@News#${tag}`,
  };
}

/** Build a realistic dataset similar to the production DB. */
function buildRealisticItems(): MentionSuggestion[] {
  const items: MentionSuggestion[] = [];

  // 2 categories
  items.push(makeCategory("book", 11));
  items.push(makeCategory("youtube", 1));

  // 17 tags (production has 17)
  const tagNames = [
    "ai", "commentary", "dev", "engineering", "finance", "fintech",
    "frontend", "infra", "investing", "management", "markets", "research",
    "sports", "startups", "systems", "tech", "world",
  ];
  for (const t of tagNames) {
    items.push(makeTag(t, t === "ai" ? 8 : t === "tech" ? 3 : 2));
  }

  // 12 sources (11 books + 1 news)
  for (let i = 0; i < 11; i++) {
    items.push(makeSource(`book-${i}`, `Book ${i}`));
  }
  items.push(makeSource("news", "News Feed", "news"));

  // 40 feeds
  for (let i = 0; i < 40; i++) {
    items.push(makeFeed(`feed-${i}`, `Feed ${i}`, ["tech"]));
  }

  return items;
}

// =============================================================================
// filterMentionItems — empty query (default dropdown)
// =============================================================================

describe("filterMentionItems", () => {
  describe("empty query — default dropdown", () => {
    it("tags are always visible with many feeds (the original bug)", () => {
      const items = buildRealisticItems();
      const result = filterMentionItems(items, "");

      const tags = result.filter((i) => i.kind === "tag");
      expect(tags.length).toBeGreaterThan(0);
      // With 17 tags, should show up to 8
      expect(tags.length).toBe(8);
    });

    it("categories appear first", () => {
      const items = buildRealisticItems();
      const result = filterMentionItems(items, "");

      expect(result[0].kind).toBe("category");
      expect(result[1].kind).toBe("category");
    });

    it("tags appear before sources and feeds", () => {
      const items = buildRealisticItems();
      const result = filterMentionItems(items, "");

      const firstTag = result.findIndex((i) => i.kind === "tag");
      const firstSource = result.findIndex((i) => i.kind === "source");
      const firstFeed = result.findIndex((i) => i.kind === "feed");

      expect(firstTag).toBeLessThan(firstSource);
      if (firstFeed >= 0) {
        expect(firstTag).toBeLessThan(firstFeed);
      }
    });

    it("total never exceeds 14", () => {
      const items = buildRealisticItems();
      const result = filterMentionItems(items, "");
      expect(result.length).toBeLessThanOrEqual(14);
    });

    it("sources are limited to 4", () => {
      const items = buildRealisticItems();
      const result = filterMentionItems(items, "");

      const sources = result.filter((i) => i.kind === "source");
      expect(sources.length).toBeLessThanOrEqual(4);
    });

    it("feeds fill remaining slots after categories, tags, sources", () => {
      // Fewer items: 1 category + 2 tags + 2 sources = 5, leaving 9 for feeds
      const items = [
        makeCategory("book", 2),
        makeTag("ai", 3),
        makeTag("tech", 2),
        makeSource("dune", "Dune"),
        makeSource("lotr", "Lord of the Rings"),
        ...Array.from({ length: 20 }, (_, i) => makeFeed(`f${i}`, `Feed ${i}`)),
      ];
      const result = filterMentionItems(items, "");

      const feeds = result.filter((i) => i.kind === "feed");
      // 14 - 1 category - 2 tags - 2 sources = 9 feed slots
      expect(feeds.length).toBe(9);
    });

    it("works with empty items", () => {
      const result = filterMentionItems([], "");
      expect(result).toEqual([]);
    });

    it("works with only sources (no feeds or tags)", () => {
      const items = [
        makeCategory("book", 3),
        makeSource("a", "Source A"),
        makeSource("b", "Source B"),
      ];
      const result = filterMentionItems(items, "");
      expect(result.length).toBe(3);
      expect(result[0].kind).toBe("category");
      expect(result[1].kind).toBe("source");
    });

    it("works with only tags and no feeds", () => {
      const items = [
        makeTag("ai", 5),
        makeTag("tech", 3),
      ];
      const result = filterMentionItems(items, "");
      expect(result.length).toBe(2);
      expect(result.every((i) => i.kind === "tag")).toBe(true);
    });

    it("caps tags at 8 when there are many", () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        makeTag(`tag${i}`, 2),
      );
      const result = filterMentionItems(items, "");
      const tags = result.filter((i) => i.kind === "tag");
      expect(tags.length).toBe(8);
    });
  });

  // ===========================================================================
  // filterMentionItems — text query (search mode)
  // ===========================================================================

  describe("text query — search mode", () => {
    it("single word matches label", () => {
      const items = [
        makeSource("dune", "Dune"),
        makeSource("lotr", "Lord of the Rings"),
        makeTag("ai", 5),
      ];
      const result = filterMentionItems(items, "dune");
      expect(result.length).toBe(1);
      expect(result[0].label).toBe("Dune");
    });

    it("single word matches tag", () => {
      const items = [
        makeSource("dune", "Dune"),
        makeTag("ai", 5),
        makeTag("tech", 3),
      ];
      const result = filterMentionItems(items, "ai");
      expect(result.length).toBe(1);
      expect(result[0].label).toBe("News #ai");
    });

    it("multi-word AND matching", () => {
      const items = [
        makeTag("ai", 8),
        makeTag("tech", 3),
        makeFeed("hn", "Hacker News", ["tech"]),
      ];
      // "ne ai" → "ne" matches "News" in label, "ai" matches "#ai"
      const result = filterMentionItems(items, "ne ai");
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("tag-ai");
    });

    it("searches sublabel (feed tags)", () => {
      const items = [
        makeFeed("hn", "Hacker News", ["tech", "startups"]),
        makeFeed("bbc", "BBC World", ["world"]),
      ];
      const result = filterMentionItems(items, "startups");
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("feed-hn");
    });

    it("searches insertText", () => {
      const items = [
        makeTag("finance", 4),
        makeTag("sports", 2),
      ];
      // insertText is "@News#finance"
      const result = filterMentionItems(items, "News#fin");
      expect(result.length).toBe(1);
      expect(result[0].id).toBe("tag-finance");
    });

    it("case-insensitive", () => {
      const items = [makeSource("dune", "Dune")];
      expect(filterMentionItems(items, "DUNE").length).toBe(1);
      expect(filterMentionItems(items, "dUnE").length).toBe(1);
    });

    it("limits results to 30", () => {
      const items = Array.from({ length: 50 }, (_, i) =>
        makeSource(`s${i}`, `Source ${i}`),
      );
      const result = filterMentionItems(items, "source");
      expect(result.length).toBe(30);
    });

    it("'news' query shows all feeds and tags, not just 10", () => {
      const items = buildRealisticItems();
      const result = filterMentionItems(items, "news");

      // Should include: News Feed source + 40 feeds + 17 tags = 58, capped at 30
      const feeds = result.filter((i) => i.kind === "feed");
      const tags = result.filter((i) => i.kind === "tag");
      expect(feeds.length + tags.length).toBeGreaterThan(10);
      expect(result.length).toBe(30);
    });

    it("returns empty for no match", () => {
      const items = [makeSource("dune", "Dune"), makeTag("ai", 5)];
      const result = filterMentionItems(items, "nonexistent");
      expect(result).toEqual([]);
    });

    it("whitespace-only query returns up to 30", () => {
      const items = Array.from({ length: 50 }, (_, i) =>
        makeSource(`s${i}`, `Source ${i}`),
      );
      const result = filterMentionItems(items, "   ");
      expect(result.length).toBe(30);
    });
  });
});

// =============================================================================
// parseMentionQuery — cursor-aware @ detection
// =============================================================================

describe("parseMentionQuery", () => {
  it("detects @ at start", () => {
    expect(parseMentionQuery("@Dune", 5)).toEqual({ query: "Dune", startIndex: 0 });
  });

  it("detects @ after whitespace", () => {
    expect(parseMentionQuery("hello @pri", 10)).toEqual({ query: "pri", startIndex: 6 });
  });

  it("finds nearest @ to cursor", () => {
    expect(parseMentionQuery("@Dune compare with @Pri", 23)).toEqual({ query: "Pri", startIndex: 19 });
  });

  it("cursor in middle of first mention", () => {
    expect(parseMentionQuery("@Dune compare", 5)).toEqual({ query: "Dune", startIndex: 0 });
  });

  it("returns null when no @", () => {
    expect(parseMentionQuery("hello", 5)).toBeNull();
  });

  it("returns null when @ is not preceded by whitespace", () => {
    expect(parseMentionQuery("email@test", 10)).toBeNull();
  });

  it("empty query right after @", () => {
    expect(parseMentionQuery("@", 1)).toEqual({ query: "", startIndex: 0 });
  });
});
