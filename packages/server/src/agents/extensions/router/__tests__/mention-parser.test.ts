/**
 * Tests for parseMentions — the two-pass mention parsing logic used by
 * the resolve_mentions router tool.
 *
 * Covered:
 *  - Keyword mentions (@News, @Paper)
 *  - Keyword + tag (@News#ai)
 *  - Keyword + qualifier (@News:Hacker News)
 *  - Keyword followed by unrelated text (@News hacker news)
 *  - Source-title fuzzy search (@Dune)
 *  - Unknown source (@Unknown → error)
 *  - Multiple mentions in one message
 *  - Plain text with no @mentions
 *  - Keyword + qualifier + trailing plain text
 */

import { describe, it, expect } from "vitest";
import {
  parseMentions,
  type MentionKeywordConfig,
  type SourceSearchResult,
} from "../mention-parser.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────────

const SOURCE_TYPE_CONFIGS: MentionKeywordConfig[] = [
  {
    key: "news",
    mentionKeyword: "News",
    fixedSourceId: "news",
    defaultMode: "news",
    sessionModes: ["news"],
    sessionStrategy: "time-based",
  },
  {
    key: "paper",
    mentionKeyword: "Paper",
    defaultMode: "reading",
    sessionModes: ["reading", "qa"],
  },
  {
    key: "book",
    mentionKeyword: "Book",
    defaultMode: "reading",
    sessionModes: ["reading", "analysis"],
  },
];

/** Mock source search that knows about a few titles. */
function mockSearchSources(query: string): SourceSearchResult[] {
  const sources: SourceSearchResult[] = [
    { id: "dune-id", title: "Dune", type: "book" },
    { id: "neuromancer-id", title: "Neuromancer", type: "book" },
  ];
  const q = query.toLowerCase();
  return sources.filter((s) => s.title.toLowerCase().includes(q));
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("parseMentions", () => {
  it("parses @News as a keyword mention with fixedSourceId", async () => {
    const result = await parseMentions("@News", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      raw: "@News",
      sourceType: "news",
      sourceId: "news",
      defaultMode: "news",
      sessionModes: ["news"],
      sessionStrategy: "time-based",
    });
    expect(result.plainText).toBe("");
  });

  it("parses @News#ai as keyword + tag", async () => {
    const result = await parseMentions("@News#ai", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      sourceType: "news",
      sourceId: "news",
      tags: ["ai"],
    });
    expect(result.plainText).toBe("");
  });

  it("parses @News:Hacker News as keyword + qualifier", async () => {
    const result = await parseMentions("@News:Hacker News", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      sourceType: "news",
      qualifier: "Hacker News",
    });
    expect(result.plainText).toBe("");
  });

  it("parses @News followed by unrelated text — keyword match + plain text preserved", async () => {
    const result = await parseMentions("@News hacker news", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      raw: "@News",
      sourceType: "news",
      sourceId: "news",
    });
    expect(result.plainText).toBe("hacker news");
  });

  it("parses @Paper as a keyword mention without fixedSourceId", async () => {
    const result = await parseMentions("@Paper", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      raw: "@Paper",
      sourceType: "paper",
      sourceId: null,
      defaultMode: "reading",
      sessionModes: ["reading", "qa"],
    });
    expect(result.mentions[0]).not.toHaveProperty("sessionStrategy");
  });

  it("parses @Dune as a fuzzy source-title match", async () => {
    const result = await parseMentions("@Dune", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      raw: "@Dune",
      sourceType: "book",
      sourceId: "dune-id",
      sourceTitle: "Dune",
      defaultMode: "reading",
      sessionModes: ["reading", "analysis"],
    });
    expect(result.plainText).toBe("");
  });

  it("returns an error mention for @Unknown when no source is found", async () => {
    const result = await parseMentions("@Unknown", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      raw: "@Unknown",
      sourceType: null,
      sourceId: null,
      error: 'No source found matching "Unknown"',
    });
  });

  it("parses two mentions: @News#ai @Dune", async () => {
    const result = await parseMentions("@News#ai @Dune", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(2);
    expect(result.mentions[0]).toMatchObject({
      sourceType: "news",
      tags: ["ai"],
    });
    expect(result.mentions[1]).toMatchObject({
      sourceType: "book",
      sourceId: "dune-id",
      sourceTitle: "Dune",
    });
    expect(result.plainText).toBe("");
  });

  it("returns empty mentions and full plainText when no @mentions are present", async () => {
    const result = await parseMentions(
      "plain text with no mentions",
      SOURCE_TYPE_CONFIGS,
      mockSearchSources,
    );

    expect(result.mentions).toHaveLength(0);
    expect(result.plainText).toBe("plain text with no mentions");
  });

  it("parses @News:Tech — qualifier capture is greedy up to # or @", async () => {
    const result = await parseMentions(
      "@News:Tech latest updates",
      SOURCE_TYPE_CONFIGS,
      mockSearchSources,
    );

    // The qualifier regex [^#@\s][^#@]* captures everything after : until # or @,
    // so "Tech latest updates" is all part of the qualifier.
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      sourceType: "news",
      qualifier: "Tech latest updates",
    });
    expect(result.plainText).toBe("");
  });

  it("is case-insensitive for keyword matching", async () => {
    const result = await parseMentions("@news", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      sourceType: "news",
      sourceId: "news",
    });
  });

  it("handles keyword + tag + qualifier together: @News:Tech#ai", async () => {
    const result = await parseMentions("@News:Tech#ai", SOURCE_TYPE_CONFIGS, mockSearchSources);

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      sourceType: "news",
      qualifier: "Tech",
      tags: ["ai"],
    });
  });

  it("title regex captures multi-word @mentions greedily", async () => {
    // @(\w+(?:\s+\w+)*) matches "Dune please" as one mention
    const result = await parseMentions(
      "tell me about @Dune please",
      SOURCE_TYPE_CONFIGS,
      mockSearchSources,
    );

    expect(result.mentions).toHaveLength(1);
    // "Dune please" is searched as a whole — no source matches
    expect(result.mentions[0]).toMatchObject({
      raw: "@Dune please",
      sourceType: null,
      sourceId: null,
      error: 'No source found matching "Dune please"',
    });
    expect(result.plainText).toBe("tell me about");
  });

  it("matches a single-word title mention when followed by punctuation", async () => {
    // When the next char isn't \w, the title regex stops at one word
    const result = await parseMentions(
      "tell me about @Dune, please",
      SOURCE_TYPE_CONFIGS,
      mockSearchSources,
    );

    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]).toMatchObject({
      sourceType: "book",
      sourceId: "dune-id",
      sourceTitle: "Dune",
    });
    expect(result.plainText).toBe("tell me about , please");
  });
});
