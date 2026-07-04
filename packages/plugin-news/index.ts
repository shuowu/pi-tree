import { Type } from "typebox";
import { definePiTreeExtension, jsonResult, textResult, toolError, fetchViaJina } from "@pi-tree/plugin-sdk";
import { RssService, saveNewsAnalysis, type IRssService } from "./rss-service.js";
import { RemoteRssClient } from "./rss-client.js";

export default definePiTreeExtension((pi, services) => {
  const remoteUrl = process.env.RSS_REMOTE_URL;
  const rssService: IRssService = remoteUrl
    ? new RemoteRssClient(remoteUrl, process.env.RSS_API_KEY)
    : new RssService({
        dataDir: services.getPluginDataDir("news"),
        dataPath: services.dataPath,
        sources: services.sources,
      });

  // Stream key prefix for news feed cursors
  const CURSOR_PREFIX = "news/feed/";

  // Helper: resolve userId from extension context
  async function resolveUserId(ctx: any): Promise<string | undefined> {
    if (ctx?.sessionManager) {
      try {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (sessionFile) return await services.sessions.resolveUserId(sessionFile);
      } catch { /* fall through */ }
    }
    return undefined;
  }

  // 1. Get Latest RSS
  pi.registerTool({
    name: "get_latest_rss",
    label: "Get Latest RSS",
    description: "Get the latest RSS feed items. Use for general news updates, chronological feeds, or checking what was recently published.",
    parameters: Type.Object({
      feeds: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed IDs to filter by." })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional list of feed tags to filter by (e.g., ['ai', 'tech']). Returns items from feeds matching any of these tags." })),
      days: Type.Optional(Type.Number({ description: "Number of recent days to query, default 3." })),
      limit: Type.Optional(Type.Number({ description: "Max items to return, default 50." })),
      since_last_read: Type.Optional(Type.Boolean({ description: "If true, only return items published after the per-feed read watermark. Prevents showing previously seen news." }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        let items = await rssService.getLatestRss({
          feeds: params.feeds,
          tags: params.tags,
          days: params.days,
          limit: params.limit
        });

        // Apply per-feed watermark filtering
        if (params.since_last_read) {
          const userId = await resolveUserId(ctx);
          if (userId) {
            const feedIds = [...new Set(items.map(i => i.feedId))];
            const keys = feedIds.map(id => `${CURSOR_PREFIX}${id}`);
            const cursors = await services.cursors.get(userId, keys);
            if (cursors.size > 0) {
              items = items.filter(item => {
                const mark = cursors.get(`${CURSOR_PREFIX}${item.feedId}`);
                return !mark || !item.publishedAt || item.publishedAt > mark;
              });
            }
          }
        }

        return jsonResult(items);
      } catch (err: any) {
        throw toolError("get latest RSS", err);
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
      limit: Type.Optional(Type.Number({ description: "Max items to return, default 50." })),
      since_last_read: Type.Optional(Type.Boolean({ description: "If true, only return items published after the per-feed read watermark. Prevents showing previously seen news." }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        let items = await rssService.getLatestRss({
          keyword: params.keyword,
          feeds: params.feeds,
          tags: params.tags,
          days: params.days ?? 7,
          limit: params.limit
        });

        // Apply per-feed watermark filtering
        if (params.since_last_read) {
          const userId = await resolveUserId(ctx);
          if (userId) {
            const feedIds = [...new Set(items.map(i => i.feedId))];
            const keys = feedIds.map(id => `${CURSOR_PREFIX}${id}`);
            const cursors = await services.cursors.get(userId, keys);
            if (cursors.size > 0) {
              items = items.filter(item => {
                const mark = cursors.get(`${CURSOR_PREFIX}${item.feedId}`);
                return !mark || !item.publishedAt || item.publishedAt > mark;
              });
            }
          }
        }

        return jsonResult(items);
      } catch (err: any) {
        throw toolError("search RSS", err);
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
      include_url: Type.Optional(Type.Boolean({ description: "Include article URLs in source metadata (default true)." })),
      since_last_read: Type.Optional(Type.Boolean({ description: "If true, only return items published after the per-feed read watermark. Prevents showing previously seen news." }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        let groups = await rssService.aggregateRss({
          feeds: params.feeds,
          tags: params.tags,
          days: params.days,
          similarityThreshold: params.similarity_threshold,
          limit: params.limit,
          includeUrl: params.include_url
        });

        // Apply per-feed watermark filtering to aggregated groups
        if (params.since_last_read) {
          const userId = await resolveUserId(ctx);
          if (userId) {
            const allFeedIds = [...new Set(groups.flatMap(g => g.feedIds))];
            const keys = allFeedIds.map(id => `${CURSOR_PREFIX}${id}`);
            const cursors = await services.cursors.get(userId, keys);
            if (cursors.size > 0) {
              groups = groups.map(group => {
                const filteredSources = group.sources.filter(src => {
                  const mark = cursors.get(`${CURSOR_PREFIX}${src.feedId}`);
                  return !mark || !src.publishedAt || src.publishedAt > mark;
                });
                if (filteredSources.length === 0) return null;
                return {
                  ...group,
                  sources: filteredSources,
                  sourceCount: filteredSources.length,
                  feeds: [...new Set(filteredSources.map(s => s.feedName))],
                  feedIds: [...new Set(filteredSources.map(s => s.feedId))],
                  isCrossFeed: new Set(filteredSources.map(s => s.feedId)).size > 1,
                };
              }).filter(Boolean) as typeof groups;
            }
          }
        }

        return jsonResult(groups);
      } catch (err: any) {
        throw toolError("aggregate RSS", err);
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
        const feeds = await rssService.listFeeds();
        return jsonResult(feeds);
      } catch (err: any) {
        throw toolError("get feeds status", err);
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
      if (remoteUrl) {
        return jsonResult({ refreshed: false, mode: "remote", message: "Feeds are crawled automatically by the remote service. Data is already fresh." });
      }
      try {
        const stats = await rssService.crawlAllFeeds();
        return jsonResult(stats);
      } catch (err: any) {
        throw toolError("refresh RSS feeds", err);
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
        const tags = await rssService.getAllFeedTags();
        const feeds = await rssService.listFeeds();
        const tagMap = tags.map((tag: any) => ({
          tag,
          feedCount: feeds.filter((f: any) => f.tags.includes(tag)).length,
          feeds: feeds.filter((f: any) => f.tags.includes(tag)).map((f: any) => f.name),
        }));
        return jsonResult(tagMap);
      } catch (err: any) {
        throw toolError("get feed tags", err);
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
        const markdown = await fetchViaJina(params.url, {
          apiKey: services.config.jinaApiKey,
        });
        return textResult(markdown);
      } catch (err: any) {
        throw toolError("read article", err);
      }
    }
  });

  // 8. Save News Analysis
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
        const relativePath = saveNewsAnalysis(services.dataPath, params.title, params.content, params.type);
        return textResult(`Successfully saved report to: ${relativePath}`);
      } catch (err: any) {
        throw toolError("save news analysis", err);
      }
    }
  });

  // 9. Mark Feeds as Read
  pi.registerTool({
    name: "mark_feeds_read",
    label: "Mark Feeds as Read",
    description: "Update the read watermark for feeds after presenting a news briefing. Prevents overlap in future sessions. Call this after your initial briefing scan.",
    parameters: Type.Object({
      feeds: Type.Optional(Type.Array(Type.String(), { description: "Feed IDs to mark as read. If omitted with no tags, marks all active feeds." })),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Feed tags to mark as read (resolved to feed IDs)." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const userId = await resolveUserId(ctx);
        if (!userId) throw new Error("Cannot determine user — watermark not updated.");

        let feedIds: string[];
        if (params.feeds?.length) {
          feedIds = params.feeds;
        } else if (params.tags?.length) {
          const tagFeeds = await rssService.getFeedsByTags(params.tags);
          feedIds = tagFeeds.map(f => f.id);
        } else {
          const allFeeds = await rssService.listFeeds();
          feedIds = allFeeds.map(f => f.id);
        }

        const now = new Date().toISOString();
        await services.cursors.set(userId,
          feedIds.map(id => ({ key: `${CURSOR_PREFIX}${id}`, value: now }))
        );

        return jsonResult({
          marked: feedIds.length,
          feedIds,
          readAt: now,
        });
      } catch (err: any) {
        throw toolError("mark feeds read", err);
      }
    }
  });
});
