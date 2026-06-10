import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import Parser from "rss-parser";
import { eq, desc } from "drizzle-orm";
import { getDb, rssFeeds, rssItems, sources, userSessions, userSourceConfig, userSourceProgress } from "../db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

export interface CrawlStats {
  feedId: string;
  feedName: string;
  status: "success" | "failed";
  itemsFetched: number;
  error?: string;
}

export interface RssItemData {
  id: number;
  title: string;
  feedId: string;
  feedName: string;
  url: string;
  guid: string;
  publishedAt: string | null;
  summary: string | null;
  author: string | null;
  createdAt: string;
}

export interface AggregatedSource {
  feedId: string;
  feedName: string;
  title: string;
  publishedAt: string | null;
  author: string | null;
  url?: string;
}

export interface AggregatedRssGroup {
  representativeTitle: string;
  feeds: string[];
  feedIds: string[];
  earliestPublishedAt: string | null;
  latestPublishedAt: string | null;
  aggregateWeight: number;
  sources: AggregatedSource[];
  isCrossFeed: boolean;
  sourceCount: number;
}

// Stopwords for inverted index candidate filtering
const STOPWORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "are", "was", "were",
  "been", "have", "has", "had", "will", "would", "could", "should", "may",
  "might", "can", "not", "but", "its", "his", "her", "their", "our", "your",
  "who", "what", "when", "how", "why", "all", "new", "says", "said", "over",
  "after", "into", "more", "than", "also", "just", "now", "get", "via",
  "inc", "corp", "ltd", "one", "two", "top"
]);

// ---------------------------------------------------------------------------
// Similarity Helpers
// ---------------------------------------------------------------------------

function lcsLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export function calculateSequenceSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const common = lcsLength(a.toLowerCase(), b.toLowerCase());
  return (2.0 * common) / (a.length + b.length);
}

export function calculateJaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase());
  const setB = new Set(b.toLowerCase());
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  let intersectionCount = 0;
  for (const char of setA) {
    if (setB.has(char)) {
      intersectionCount++;
    }
  }
  return intersectionCount / union.size;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The canonical source ID for the news collection in the sources table */
const NEWS_SOURCE_ID = "news";

// ---------------------------------------------------------------------------
// RssService
// ---------------------------------------------------------------------------

export class RssService {
  private parser: Parser;
  private dataPath: string;

  constructor() {
    this.parser = new Parser();
    this.dataPath =
      process.env.DATA_PATH ??
      join(os.homedir(), ".local", "share", "pi-tree");
  }

  // -------------------------------------------------------------------------
  // Feed Management (DB-only)
  // -------------------------------------------------------------------------

  /**
   * Ensure the canonical news source row exists in the sources table.
   */
  private ensureNewsSource(): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.insert(sources)
      .values({
        id: NEWS_SOURCE_ID,
        type: "news",
        title: "News & Trends Feed",
        author: "TrendRadar",
        source: "system",
        status: "ready",
        metadata: JSON.stringify({ description: "Aggregated RSS news feeds" }),
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()
      .run();

    // Migrate from old "news-tech" source ID if it exists
    const OLD_ID = "news-tech";
    const oldSource = db.select({ id: sources.id }).from(sources)
      .where(eq(sources.id, OLD_ID)).all();
    if (oldSource.length > 0) {
      // Re-point all dependent rows to the new source ID
      db.update(rssFeeds).set({ sourceId: NEWS_SOURCE_ID }).where(eq(rssFeeds.sourceId, OLD_ID)).run();
      db.update(userSessions).set({ sourceId: NEWS_SOURCE_ID }).where(eq(userSessions.sourceId, OLD_ID)).run();
      db.update(userSourceConfig).set({ sourceId: NEWS_SOURCE_ID }).where(eq(userSourceConfig.sourceId, OLD_ID)).run();
      db.update(userSourceProgress).set({ sourceId: NEWS_SOURCE_ID }).where(eq(userSourceProgress.sourceId, OLD_ID)).run();
      db.delete(sources).where(eq(sources.id, OLD_ID)).run();
    }
  }

  /**
   * Seed default feeds into the database if no feeds exist yet.
   * Called once on startup. Reads from the shipped default-feeds.json.
   */
  public seedDefaultFeeds(): void {
    const db = getDb();

    // Always ensure the canonical news source exists (idempotent)
    this.ensureNewsSource();

    // Only seed feeds if no feeds exist
    const existing = db.select({ id: rssFeeds.id }).from(rssFeeds).limit(1).all();
    if (existing.length > 0) return;

    // Load defaults from the shipped config file
    let defaultFeeds: FeedConfig[];
    try {
      const raw = readFileSync(
        join(import.meta.dirname, "../../config/default-feeds.json"),
        "utf-8",
      );
      defaultFeeds = JSON.parse(raw) as FeedConfig[];
    } catch {
      // Fallback to inline defaults if config file is missing
      defaultFeeds = [
        { id: "hacker-news", name: "Hacker News", url: "https://news.ycombinator.com/rss", tags: ["tech"] },
        { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", tags: ["tech", "ai"] }
      ];
    }

    const now = new Date().toISOString();
    for (const feed of defaultFeeds) {
      db.insert(rssFeeds)
        .values({
          id: feed.id,
          sourceId: NEWS_SOURCE_ID,
          name: feed.name,
          url: feed.url,
          tags: JSON.stringify(feed.tags),
          isActive: 1,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing()
        .run();
    }

    console.log(`[rss-service] Seeded ${defaultFeeds.length} default feeds from default-feeds.json`);
  }

  /** List all active feeds from DB */
  public listFeeds(): FeedConfig[] {
    const db = getDb();
    const rows = db.select().from(rssFeeds).where(eq(rssFeeds.isActive, 1)).all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      url: r.url,
      tags: JSON.parse(r.tags ?? "[]") as string[],
    }));
  }

  /** Add a feed to the DB */
  public addFeed(feed: FeedConfig): void {
    this.ensureNewsSource();

    const db = getDb();
    const now = new Date().toISOString();
    db.insert(rssFeeds)
      .values({
        id: feed.id,
        sourceId: NEWS_SOURCE_ID,
        name: feed.name,
        url: feed.url,
        tags: JSON.stringify(feed.tags),
        isActive: 1,
        createdAt: now,
        updatedAt: now
      })
      .run();
  }

  /** Remove a feed from the DB. Returns true if a feed was deleted. */
  public removeFeed(feedId: string): boolean {
    const db = getDb();
    const result = db.delete(rssFeeds).where(eq(rssFeeds.id, feedId)).run();
    return result.changes > 0;
  }

  /** Get feeds matching any of the given tags */
  getFeedsByTags(filterTags: string[]): FeedConfig[] {
    const feeds = this.listFeeds();
    return feeds.filter(f => f.tags.some(t => filterTags.includes(t)));
  }

  /** Get all unique tags across all feeds, sorted */
  getAllFeedTags(): string[] {
    const feeds = this.listFeeds();
    const tagSet = new Set<string>();
    feeds.forEach(f => f.tags.forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }

  // -------------------------------------------------------------------------
  // Fetch / Crawl logic
  // -------------------------------------------------------------------------

  public async crawlAllFeeds(): Promise<CrawlStats[]> {
    const feeds = this.listFeeds();
    const stats: CrawlStats[] = [];

    for (const feed of feeds) {
      try {
        console.log(`[rss-service] Fetching feed: ${feed.name} (${feed.url})`);
        const parsed = await this.parser.parseURL(feed.url);
        const db = getDb();
        const now = new Date().toISOString();
        let itemsSaved = 0;

        for (const item of parsed.items) {
          const title = item.title;
          const url = item.link;
          if (!title || !url) continue;

          const guid = item.guid || item.id || url;
          const publishedAt = item.pubDate || item.isoDate || now;
          const summary = item.contentSnippet || item.summary || item.content || "";
          const author = item.creator || item.author || "";

          // Insert or skip if already crawled
          try {
            db.insert(rssItems)
              .values({
                title,
                feedId: feed.id,
                url,
                guid,
                publishedAt,
                summary,
                author,
                createdAt: now,
                updatedAt: now
              })
              .run();
            itemsSaved++;
          } catch {
            // Unique index/duplicate item constraint hit, skip
          }
        }

        // Update feed status
        db.update(rssFeeds)
          .set({
            lastFetchTime: now,
            lastFetchStatus: "success",
            updatedAt: now
          })
          .where(eq(rssFeeds.id, feed.id))
          .run();

        stats.push({
          feedId: feed.id,
          feedName: feed.name,
          status: "success",
          itemsFetched: itemsSaved
        });

      } catch (err) {
        console.error(`[rss-service] Error crawling feed ${feed.id}:`, err);
        const db = getDb();
        db.update(rssFeeds)
          .set({
            lastFetchStatus: "failed",
            updatedAt: new Date().toISOString()
          })
          .where(eq(rssFeeds.id, feed.id))
          .run();

        stats.push({
          feedId: feed.id,
          feedName: feed.name,
          status: "failed",
          itemsFetched: 0,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return stats;
  }

  // -------------------------------------------------------------------------
  // Query & Aggregation logic
  // -------------------------------------------------------------------------

  public async getLatestRss(options?: {
    feeds?: string[];
    tags?: string[];
    days?: number;
    limit?: number;
    keyword?: string;
  }): Promise<RssItemData[]> {
    const db = getDb();
    const days = options?.days ?? 3;
    const limit = options?.limit ?? 100;

    // Filter by date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString();

    // Query DB items
    let query = db
      .select({
        id: rssItems.id,
        title: rssItems.title,
        feedId: rssItems.feedId,
        feedName: rssFeeds.name,
        url: rssItems.url,
        guid: rssItems.guid,
        publishedAt: rssItems.publishedAt,
        summary: rssItems.summary,
        author: rssItems.author,
        createdAt: rssItems.createdAt
      })
      .from(rssItems)
      .innerJoin(rssFeeds, eq(rssItems.feedId, rssFeeds.id))
      .orderBy(desc(rssItems.publishedAt));

    const results = query.all();

    // Resolve tags to feed IDs and merge with explicit feeds filter
    let feedFilter = options?.feeds ? [...options.feeds] : undefined;
    if (options?.tags && options.tags.length > 0) {
      const tagFeedIds = this.getFeedsByTags(options.tags).map(f => f.id);
      if (feedFilter) {
        // Merge: include feeds matching either explicit IDs or tags
        const merged = new Set([...feedFilter, ...tagFeedIds]);
        feedFilter = [...merged];
      } else {
        feedFilter = tagFeedIds;
      }
    }

    // Filter in-memory for dates, optional feed IDs, and keywords
    let filtered = results.filter((item) => {
      if (item.publishedAt && item.publishedAt < cutoffStr) return false;
      if (feedFilter && feedFilter.length > 0 && !feedFilter.includes(item.feedId)) return false;
      if (options?.keyword) {
        const kw = options.keyword.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(kw);
        const matchesSummary = item.summary ? item.summary.toLowerCase().includes(kw) : false;
        if (!matchesTitle && !matchesSummary) return false;
      }
      return true;
    });

    return filtered.slice(0, limit);
  }

  /**
   * Cross-feed RSS Aggregation and Deduplication.
   *
   * Group similar stories across sources. Uses character-level similarity (Jaccard)
   * and sequence similarity (LCS) after filtering candidates via a word inverted index.
   */
  public async aggregateRss(options?: {
    feeds?: string[];
    tags?: string[];
    days?: number;
    similarityThreshold?: number;
    limit?: number;
    includeUrl?: boolean;
  }): Promise<AggregatedRssGroup[]> {
    const threshold = options?.similarityThreshold ?? 0.85;
    const limit = options?.limit ?? 50;

    // 1. Get raw items (pull a larger batch to find duplicates across feeds)
    const rawItems = await this.getLatestRss({
      feeds: options?.feeds,
      tags: options?.tags,
      days: options?.days ?? 3,
      limit: 1000
    });

    if (rawItems.length === 0) return [];

    // 2. Build inverted index of significant words to quickly select match candidates
    const wordIndex = new Map<string, Set<number>>();
    const prepared = rawItems.map((item, idx) => {
      const title = item.title;
      const charSet = new Set(title.toLowerCase());
      
      // Extract significant words (lowercase, length > 3, not stopwords)
      const words = new Set(
        title
          .toLowerCase()
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .filter((w) => w.length > 3 && !STOPWORDS.has(w))
      );

      for (const word of words) {
        if (!wordIndex.has(word)) {
          wordIndex.set(word, new Set());
        }
        wordIndex.get(word)!.add(idx);
      }

      // Simple heuristic weight: more content/author/summary gets higher weight
      const weight = 1.0 + (item.summary ? 0.5 : 0) + (item.author ? 0.2 : 0);

      return {
        origIdx: idx,
        data: item,
        charSet,
        setLen: charSet.size,
        sigWords: words,
        weight
      };
    });

    // Sort prepared items by weight descending so the best detailed item becomes the representative
    const sortedItems = [...prepared].sort((a, b) => b.weight - a.weight);

    const aggregated: AggregatedRssGroup[] = [];
    const usedIndices = new Set<number>();
    const PRE_FILTER_RATIO = 0.5;

    for (let i = 0; i < sortedItems.length; i++) {
      if (usedIndices.has(i)) continue;

      const item = sortedItems[i];
      const news = item.data;
      const baseSet = item.charSet;
      const baseLen = item.setLen;

      // Start a new group
      const source: AggregatedSource = {
        feedId: news.feedId,
        feedName: news.feedName,
        title: news.title,
        publishedAt: news.publishedAt,
        author: news.author
      };
      if (options?.includeUrl !== false) {
        source.url = news.url;
      }

      const group: AggregatedRssGroup = {
        representativeTitle: news.title,
        feeds: [news.feedName],
        feedIds: [news.feedId],
        earliestPublishedAt: news.publishedAt,
        latestPublishedAt: news.publishedAt,
        aggregateWeight: item.weight,
        sources: [source],
        isCrossFeed: false,
        sourceCount: 1
      };

      usedIndices.add(i);

      // Find candidates sharing at least one significant word
      const candidates = new Set<number>();
      for (const word of item.sigWords) {
        const matchingIdxs = wordIndex.get(word);
        if (matchingIdxs) {
          for (const mid of matchingIdxs) {
            candidates.add(mid);
          }
        }
      }

      // Compare against other items that are candidates and not yet grouped
      for (let j = i + 1; j < sortedItems.length; j++) {
        if (usedIndices.has(j)) continue;

        const compareItem = sortedItems[j];
        if (!candidates.has(compareItem.origIdx)) continue;

        const compareNews = compareItem.data;

        const compareSet = compareItem.charSet;
        const compareLen = compareItem.setLen;

        if (baseLen === 0 || compareLen === 0) continue;

        // Stage 1: Character set size ratio check
        const lenRatio = Math.min(baseLen, compareLen) / Math.max(baseLen, compareLen);
        if (lenRatio < threshold * PRE_FILTER_RATIO) continue;

        // Stage 2: Character-level Jaccard similarity
        const jaccardSim = calculateJaccardSimilarity(news.title, compareNews.title);
        if (jaccardSim < threshold * PRE_FILTER_RATIO) continue;

        // Stage 3: SequenceMatcher Similarity (LCS)
        const seqSim = calculateSequenceSimilarity(news.title, compareNews.title);
        if (seqSim < threshold) continue;

        // Merge item into this group
        if (!group.feeds.includes(compareNews.feedName)) {
          group.feeds.push(compareNews.feedName);
        }
        if (!group.feedIds.includes(compareNews.feedId)) {
          group.feedIds.push(compareNews.feedId);
        }

        // Incremental weight for multiple sources covering the same story
        group.aggregateWeight += compareItem.weight * 0.5;

        // Min/Max published time boundary
        const cmpPub = compareNews.publishedAt;
        if (cmpPub) {
          if (!group.earliestPublishedAt || cmpPub < group.earliestPublishedAt) {
            group.earliestPublishedAt = cmpPub;
          }
          if (!group.latestPublishedAt || cmpPub > group.latestPublishedAt) {
            group.latestPublishedAt = cmpPub;
          }
        }

        const newSource: AggregatedSource = {
          feedId: compareNews.feedId,
          feedName: compareNews.feedName,
          title: compareNews.title,
          publishedAt: cmpPub,
          author: compareNews.author
        };
        if (options?.includeUrl !== false) {
          newSource.url = compareNews.url;
        }
        group.sources.push(newSource);
        usedIndices.add(j);
      }

      group.sourceCount = group.sources.length;
      group.isCrossFeed = group.feedIds.length > 1;

      aggregated.push(group);
    }

    // Sort by aggregate weight descending (stories covered by more outlets bubble up)
    aggregated.sort((a, b) => b.aggregateWeight - a.aggregateWeight);

    return aggregated.slice(0, limit);
  }

  /**
   * Save a generated analysis or summary to the local filesystem.
   * Writes to DATA_PATH/news/[type]/[YYYY-MM-DD_slug].md
   */
  public saveAnalysis(title: string, content: string, type: "analyses" | "summaries"): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    const date = new Date().toISOString().split("T")[0];
    const filename = `${date}_${slug}.md`;
    const dir = join(this.dataPath, "news", type);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, filename);
    writeFileSync(filePath, content, "utf-8");
    return join("news", type, filename);
  }
}
