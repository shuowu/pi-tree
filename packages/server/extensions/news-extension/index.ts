import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { RssService } from "../../src/services/rss.service.js";

export default function (pi: ExtensionAPI) {
  const rssService = new RssService();

  // 1. Get Latest RSS
  pi.registerTool({
    name: "get_latest_rss",
    label: "Get Latest RSS",
    description: "Get the latest RSS feed items. Use for general news updates, chronological feeds, or checking what was recently published.",
    parameters: Type.Object({
      feeds: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed IDs to filter by." })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed tags to filter by (e.g., ['ai', 'tech']). Returns items from feeds matching any of these tags." })),
      days: Type.Optional(Type.Number({ description: "Number of recent days to query, default 3." })),
      limit: Type.Optional(Type.Number({ description: "Max items to return, default 50." }))
    }),
    async execute(_toolCallId, params) {
      try {
        const items = await rssService.getLatestRss({
          feeds: params.feeds,
          tags: params.tags,
          days: params.days,
          limit: params.limit
        });
        return {
          content: [{ type: "text", text: JSON.stringify(items, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to get latest RSS: ${err.message}`);
      }
    }
  });

  // 2. Search RSS
  pi.registerTool({
    name: "search_rss",
    label: "Search RSS",
    description: "Search for specific keywords in RSS feed titles and summaries. Use for keyword-specific queries.",
    parameters: Type.Object({
      keyword: Type.String({ description: "Keyword search term." }),
      feeds: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed IDs to filter by." })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed tags to filter by (e.g., ['ai', 'tech']). Returns items from feeds matching any of these tags." })),
      days: Type.Optional(Type.Number({ description: "Number of recent days to search, default 7." })),
      limit: Type.Optional(Type.Number({ description: "Max items to return, default 50." }))
    }),
    async execute(_toolCallId, params) {
      try {
        const items = await rssService.getLatestRss({
          keyword: params.keyword,
          feeds: params.feeds,
          tags: params.tags,
          days: params.days ?? 7,
          limit: params.limit
        });
        return {
          content: [{ type: "text", text: JSON.stringify(items, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to search RSS: ${err.message}`);
      }
    }
  });

  // 3. Aggregate RSS (Deduplication)
  pi.registerTool({
    name: "aggregate_rss",
    label: "Aggregate & Deduplicate RSS",
    description: "Cross-feed RSS aggregation — deduplicate similar stories across sources. Group stories covered by multiple outlets into single groups with full source attribution.",
    parameters: Type.Object({
      feeds: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed IDs to aggregate." })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed tags to filter by (e.g., ['ai', 'tech']). Returns items from feeds matching any of these tags." })),
      days: Type.Optional(Type.Number({ description: "Number of recent days to aggregate, default 3." })),
      similarity_threshold: Type.Optional(Type.Number({ description: "Similarity threshold between 0.3 and 1.0. Higher = fewer merges (default 0.85)." })),
      limit: Type.Optional(Type.Number({ description: "Max groups to return, default 50." })),
      include_url: Type.Optional(Type.Boolean({ description: "Include article URLs in source metadata (default true)." }))
    }),
    async execute(_toolCallId, params) {
      try {
        const groups = await rssService.aggregateRss({
          feeds: params.feeds,
          tags: params.tags,
          days: params.days,
          similarityThreshold: params.similarity_threshold,
          limit: params.limit,
          includeUrl: params.include_url
        });
        return {
          content: [{ type: "text", text: JSON.stringify(groups, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to aggregate RSS: ${err.message}`);
      }
    }
  });

  // 4. Get RSS Feeds Status
  pi.registerTool({
    name: "get_rss_feeds_status",
    label: "Get RSS Feeds Status",
    description: "Check RSS feed configurations and status. Shows list of available feeds, feed IDs, URLs, and last fetch status.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const feeds = rssService.getFeedsConfig();
        return {
          content: [{ type: "text", text: JSON.stringify(feeds, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to get feeds status: ${err.message}`);
      }
    }
  });

  // 5. Trigger RSS Refresh (Crawl)
  pi.registerTool({
    name: "trigger_rss_refresh",
    label: "Trigger RSS Refresh",
    description: "Manually trigger an RSS data refresh. Fetches all enabled RSS feeds, saves items to database, and updates feed statuses.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const stats = await rssService.crawlAllFeeds();
        return {
          content: [{ type: "text", text: JSON.stringify(stats, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to refresh RSS feeds: ${err.message}`);
      }
    }
  });

  // 6. Get Feed Tags
  pi.registerTool({
    name: "get_feed_tags",
    label: "Get Feed Tags",
    description: "List all unique tags across RSS feeds with their associated feeds. Use to understand what topic categories are available for tag-based filtering.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const tags = rssService.getAllFeedTags();
        const feeds = rssService.getFeedsConfig();
        const tagMap = tags.map(tag => ({
          tag,
          feedCount: feeds.filter(f => f.tags.includes(tag)).length,
          feeds: feeds.filter(f => f.tags.includes(tag)).map(f => f.name),
        }));
        return { content: [{ type: "text", text: JSON.stringify(tagMap, null, 2) }] };
      } catch (err: any) {
        throw new Error(`Failed to get feed tags: ${err.message}`);
      }
    }
  });

  // 7. Read Article (using free public Jina Reader API)
  pi.registerTool({
    name: "read_article",
    label: "Read Article Content",
    description: "Extract clean Markdown content from an article URL. Bypass paywalls and return readable text.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL of the article to read." })
    }),
    async execute(_toolCallId, params) {
      try {
        const response = await fetch(`https://r.jina.ai/${params.url}`, {
          headers: {
            "Accept": "text/markdown"
          }
        });
        if (!response.ok) {
          throw new Error(`Jina Reader returned status ${response.status}`);
        }
        const markdown = await response.text();
        return {
          content: [{ type: "text", text: markdown }]
        };
      } catch (err: any) {
        throw new Error(`Failed to read article: ${err.message}`);
      }
    }
  });

  // 7. Save News Analysis
  pi.registerTool({
    name: "save_news_analysis",
    label: "Save News Analysis",
    description: "Save a generated news analysis or weekly/daily digest to a Markdown file on the local filesystem.",
    parameters: Type.Object({
      title: Type.String({ description: "The title of the analysis (will be slugified for filename)." }),
      content: Type.String({ description: "The complete synthesized Markdown content to save." }),
      type: Type.Union([Type.Literal("analyses"), Type.Literal("summaries")], { description: "Type of report: 'analyses' (for deep dives) or 'summaries' (for digests)." })
    }),
    async execute(_toolCallId, params) {
      try {
        const relativePath = rssService.saveAnalysis(params.title, params.content, params.type);
        return {
          content: [{ type: "text", text: `Successfully saved report to: ${relativePath}` }]
        };
      } catch (err: any) {
        throw new Error(`Failed to save news analysis: ${err.message}`);
      }
    }
  });
}
