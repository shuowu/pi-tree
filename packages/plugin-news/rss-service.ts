import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import Parser from "rss-parser";
import { eq, desc } from "drizzle-orm";
import { getNewsDb, rssFeeds, rssItems } from "./db.js";
import type { SourceService } from "@pi-tree/plugin-sdk";

// ---------------------------------------------------------------------------
// Date helpers
//
// Feed dates arrive in mixed formats (RFC-822 "Wed, 24 Jun 2026 23:57:37 GMT"
// from item.pubDate, ISO 8601 from item.isoDate). Comparing/sorting these as
// raw strings is wrong — RFC-822 strings don't order chronologically and never
// compare correctly against ISO cutoffs. Always parse to epoch ms for compares,
// and normalize to ISO 8601 on write so stored values are consistent.
// ---------------------------------------------------------------------------

/** Parse any supported date string to epoch ms, or NaN if unparseable/empty. */
export function toEpochMs(value?: string | null): number {
  if (!value) return NaN;
  return new Date(value).getTime();
}

/** Normalize a date string to ISO 8601, or null if unparseable/empty. */
export function toIsoOrNull(value?: string | null): string | null {
  const ms = toEpochMs(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

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

export type RssItemTag = "news" | "youtube";

export interface RssItemData {
  id: number;
  title: string;
  feedId: string;
  feedName: string;
  feedTags: string[];
  url: string;
  guid: string;
  publishedAt: string | null;
  summary: string | null;
  author: string | null;
  tag: string;
  promotedSourceId: string | null;
  createdAt: string;
}

export interface RssItemUpdates {
  tag?: RssItemTag;
  promotedSourceId?: string | null;
}

/**
 * Classify a crawled item by its URL. Kept consistent with the SQL backfill in
 * drizzle/0001 (`url LIKE '%youtube.com/%' OR url LIKE '%youtu.be/%'`).
 */
export function detectItemTag(url: string): RssItemTag {
  return /(?:youtube\.com|youtu\.be)\//i.test(url) ? "youtube" : "news";
}

/** Parse a feed's tags JSON column, tolerating null/malformed values. */
function parseFeedTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

// ---------------------------------------------------------------------------
// IRssService — public query/mutation interface
// ---------------------------------------------------------------------------

export interface IRssService {
  listFeeds(): Promise<FeedConfig[]>;
  addFeed(feed: FeedConfig): Promise<void>;
  removeFeed(feedId: string): Promise<boolean>;
  updateFeed(feedId: string, updates: Partial<Pick<FeedConfig, "name" | "url" | "tags">>): Promise<boolean>;
  getFeedsByTags(filterTags: string[]): Promise<FeedConfig[]>;
  getAllFeedTags(): Promise<string[]>;
  getLatestRss(options?: { feeds?: string[]; tags?: string[]; days?: number; limit?: number; offset?: number; keyword?: string; itemTag?: string }): Promise<RssItemData[]>;
  updateItem(itemId: number, updates: RssItemUpdates): Promise<boolean>;
  aggregateRss(options?: { feeds?: string[]; tags?: string[]; days?: number; similarityThreshold?: number; limit?: number; includeUrl?: boolean }): Promise<AggregatedRssGroup[]>;
  crawlAllFeeds(): Promise<CrawlStats[]>;
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
// RssService — plugin-local version using own DB
// ---------------------------------------------------------------------------

export interface RssServiceConfig {
  /** Plugin's own data directory ($DATA_PATH/plugins/news/) */
  dataDir: string;
  /** Shared data path ($DATA_PATH) */
  dataPath: string;
  /** Typed source service for core sources table access (optional — not needed in standalone crawler mode) */
  sources?: SourceService;
}

/**
 * Save a generated analysis or summary to the local filesystem.
 * Standalone function — usable without RssService instance.
 */
export function saveNewsAnalysis(dataPath: string, title: string, content: string, type: "analyses" | "summaries"): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const date = new Date().toISOString().split("T")[0];
  const filename = `${date}_${slug}.md`;
  const dir = join(dataPath, "sources", "news", type);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, "utf-8");
  return join("sources", "news", type, filename);
}

export class RssService implements IRssService {
  private parser: Parser;
  private dataDir: string;
  private dataPath: string;
  private sources?: SourceService;

  constructor(config: RssServiceConfig) {
    this.parser = new Parser();
    this.dataDir = config.dataDir;
    this.dataPath = config.dataPath;
    this.sources = config.sources;
  }

  private async getDb() {
    return await getNewsDb(this.dataDir);
  }

  // -------------------------------------------------------------------------
  // Feed Management (DB-only)
  // -------------------------------------------------------------------------

  /**
   * Ensure the canonical news source row exists in the core sources table.
   */
  private ensureNewsSource(): void {
    if (!this.sources) return;  // standalone crawler mode — no core sources table
    this.sources.create({
      id: NEWS_SOURCE_ID,
      type: "news",
      title: "News Feed",
      author: "",
      source: "system",
      status: "ready",
      metadata: { description: "Aggregated RSS news feeds" },
    });
  }

  /**
   * Sync default feeds into the database — adds any feeds from config
   * that don't already exist in the DB (upsert by id).
   * Called on every startup. Reads from feeds.local.yml (user override)
   * or the shipped default-feeds.yml.
   */
  public async seedDefaultFeeds(): Promise<void> {
    const db = await this.getDb();

    // Always ensure the canonical news source exists (idempotent)
    this.ensureNewsSource();

    // Load defaults — prefer local override over shipped config
    const pluginDir = dirname(fileURLToPath(import.meta.url));
    const configDir = join(pluginDir, "config");
    const localPath = join(configDir, "feeds.local.yml");
    const defaultPath = join(configDir, "default-feeds.yml");
    const feedsPath = existsSync(localPath) ? localPath : defaultPath;

    const raw = readFileSync(feedsPath, "utf-8");
    const defaultFeeds = yaml.load(raw) as FeedConfig[];

    // Get existing feed IDs for diff
    const existingRows = await db.select({ id: rssFeeds.id }).from(rssFeeds).all();
    const existingIds = new Set(existingRows.map(r => r.id));

    const newFeeds = defaultFeeds.filter(f => !existingIds.has(f.id));
    if (newFeeds.length === 0) return;

    const now = new Date().toISOString();
    for (const feed of newFeeds) {
      await db.insert(rssFeeds)
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

    const source = feedsPath === localPath ? "feeds.local.yml" : "default-feeds.yml";
    console.log(`[news] Added ${newFeeds.length} new feeds from ${source} (${existingIds.size} existing)`);
  }

  /** List all active feeds from DB */
  public async listFeeds(): Promise<FeedConfig[]> {
    const db = await this.getDb();
    const rows = await db.select().from(rssFeeds).where(eq(rssFeeds.isActive, 1)).all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      url: r.url,
      tags: JSON.parse(r.tags ?? "[]") as string[],
    }));
  }

  /** Add a feed to the DB */
  public async addFeed(feed: FeedConfig): Promise<void> {
    this.ensureNewsSource();

    const db = await this.getDb();
    const now = new Date().toISOString();
    await db.insert(rssFeeds)
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
  public async removeFeed(feedId: string): Promise<boolean> {
    const db = await this.getDb();
    const result = await db.delete(rssFeeds).where(eq(rssFeeds.id, feedId)).run();
    return result.rowsAffected > 0;
  }

  /** Update a feed's name, url, and/or tags. Returns true if a feed was updated. */
  public async updateFeed(feedId: string, updates: Partial<Pick<FeedConfig, "name" | "url" | "tags">>): Promise<boolean> {
    const db = await this.getDb();
    const values: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.name !== undefined) values.name = updates.name;
    if (updates.url !== undefined) values.url = updates.url;
    if (updates.tags !== undefined) values.tags = JSON.stringify(updates.tags);
    const result = await db.update(rssFeeds).set(values).where(eq(rssFeeds.id, feedId)).run();
    return result.rowsAffected > 0;
  }

  /** Get feeds matching any of the given tags */
  async getFeedsByTags(filterTags: string[]): Promise<FeedConfig[]> {
    const feeds = await this.listFeeds();
    return feeds.filter(f => f.tags.some(t => filterTags.includes(t)));
  }

  /** Get all unique tags across all feeds, sorted */
  async getAllFeedTags(): Promise<string[]> {
    const feeds = await this.listFeeds();
    const tagSet = new Set<string>();
    feeds.forEach(f => f.tags.forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }

  // -------------------------------------------------------------------------
  // Staleness check — called at startup
  // -------------------------------------------------------------------------

  /**
   * Check if feeds are stale and crawl in background if so.
   */
  public async checkAndCrawlIfStale(crawlIntervalMs: number): Promise<void> {
    const db = await this.getDb();
    const latest = await db.select({ lastFetch: rssFeeds.lastFetchTime })
      .from(rssFeeds)
      .orderBy(desc(rssFeeds.lastFetchTime))
      .limit(1)
      .all();

    const lastFetch = latest[0]?.lastFetch;
    const staleMs = lastFetch ? Date.now() - new Date(lastFetch).getTime() : Infinity;

    if (staleMs > crawlIntervalMs) {
      const reason = lastFetch ? `stale (${Math.round(staleMs / 60000)}min ago)` : "never crawled";
      console.log(`📡 [news] RSS feeds are ${reason}. Crawling in background...`);
      this.crawlAllFeeds()
        .then((stats) => {
          const fetched = stats.reduce((acc, s) => acc + s.itemsFetched, 0);
          console.log(`📡 [news] Startup crawl completed: fetched ${fetched} new items.`);
        })
        .catch((err) => console.error("[news] Startup crawl failed:", err));
    } else {
      console.log(`📡 [news] RSS feeds are fresh (last crawl ${Math.round(staleMs / 60000)}min ago). Skipping startup crawl.`);
    }
  }

  // -------------------------------------------------------------------------
  // Fetch / Crawl logic
  // -------------------------------------------------------------------------

  public async crawlAllFeeds(): Promise<CrawlStats[]> {
    const feeds = await this.listFeeds();
    const stats: CrawlStats[] = [];

    for (const feed of feeds) {
      try {
        console.log(`[news] Fetching feed: ${feed.name} (${feed.url})`);
        const parsed = await this.parser.parseURL(feed.url);
        const db = await this.getDb();
        const now = new Date().toISOString();
        let itemsSaved = 0;

        for (const item of parsed.items) {
          const title = item.title;
          const url = item.link;
          if (!title || !url) continue;

          const guid = item.guid || item.id || url;
          // Prefer rss-parser's ISO date; fall back to RFC-822 pubDate. Normalize
          // to ISO 8601 so stored values sort and compare chronologically.
          const publishedAt = toIsoOrNull(item.isoDate || item.pubDate) || now;
          const summary = item.contentSnippet || item.summary || item.content || "";
          const author = item.creator || item.author || "";

          // Insert or skip if already crawled
          try {
            await db.insert(rssItems)
              .values({
                title,
                feedId: feed.id,
                url,
                guid,
                publishedAt,
                summary,
                author,
                tag: detectItemTag(url),
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
        await db.update(rssFeeds)
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
        console.error(`[news] Error crawling feed ${feed.id}:`, err);
        const db = await this.getDb();
        await db.update(rssFeeds)
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
    offset?: number;
    keyword?: string;
    itemTag?: string;
  }): Promise<RssItemData[]> {
    const db = await this.getDb();
    const days = options?.days ?? 3;
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    // Filter by date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffMs = cutoffDate.getTime();

    // Query DB items. Ordering is done in-memory below by parsed timestamp —
    // a SQL ORDER BY on published_at sorts lexicographically, which is wrong for
    // any non-ISO date string (legacy rows may be RFC-822).
    const query = db
      .select({
        id: rssItems.id,
        title: rssItems.title,
        feedId: rssItems.feedId,
        feedName: rssFeeds.name,
        feedTags: rssFeeds.tags,
        url: rssItems.url,
        guid: rssItems.guid,
        publishedAt: rssItems.publishedAt,
        summary: rssItems.summary,
        author: rssItems.author,
        tag: rssItems.tag,
        promotedSourceId: rssItems.promotedSourceId,
        createdAt: rssItems.createdAt
      })
      .from(rssItems)
      .innerJoin(rssFeeds, eq(rssItems.feedId, rssFeeds.id));

    const results = await query.all();

    // Resolve tags to feed IDs and merge with explicit feeds filter
    let feedFilter = options?.feeds ? [...options.feeds] : undefined;
    if (options?.tags && options.tags.length > 0) {
      const tagFeedIds = (await this.getFeedsByTags(options.tags)).map(f => f.id);
      if (feedFilter) {
        // Merge: include feeds matching either explicit IDs or tags
        const merged = new Set([...feedFilter, ...tagFeedIds]);
        feedFilter = [...merged];
      } else {
        feedFilter = tagFeedIds;
      }
    }

    // Filter in-memory for dates, optional feed IDs, and keywords
    const filtered = results.filter((item) => {
      const ms = toEpochMs(item.publishedAt);
      // Drop items older than the cutoff. Unparseable dates are kept (can't
      // reliably age them out) rather than silently discarded.
      if (!Number.isNaN(ms) && ms < cutoffMs) return false;
      if (feedFilter && feedFilter.length > 0 && !feedFilter.includes(item.feedId)) return false;
      if (options?.itemTag && item.tag !== options.itemTag) return false;
      if (options?.keyword) {
        const kw = options.keyword.toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(kw);
        const matchesSummary = item.summary ? item.summary.toLowerCase().includes(kw) : false;
        if (!matchesTitle && !matchesSummary) return false;
      }
      return true;
    });

    // Sort newest-first by parsed timestamp (unparseable dates sort last).
    filtered.sort((a, b) => {
      const ta = toEpochMs(a.publishedAt);
      const tb = toEpochMs(b.publishedAt);
      return (Number.isNaN(tb) ? -Infinity : tb) - (Number.isNaN(ta) ? -Infinity : ta);
    });

    // Page after filter+sort so offset/limit walk a stable newest-first order,
    // and parse the feed's tags JSON into an array for consumers.
    return filtered.slice(offset, offset + limit).map((item) => ({
      ...item,
      feedTags: parseFeedTags(item.feedTags),
    }));
  }

  public async updateItem(itemId: number, updates: RssItemUpdates): Promise<boolean> {
    const db = await this.getDb();
    const set: Record<string, string | null> = { updatedAt: new Date().toISOString() };
    if (updates.tag !== undefined) set.tag = updates.tag;
    if (updates.promotedSourceId !== undefined) set.promotedSourceId = updates.promotedSourceId;
    const result = await db.update(rssItems)
      .set(set)
      .where(eq(rssItems.id, itemId))
      .run();
    return result.rowsAffected > 0;
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

        // Min/Max published time boundary (compare by parsed timestamp)
        const cmpPub = compareNews.publishedAt;
        const cmpMs = toEpochMs(cmpPub);
        if (cmpPub && !Number.isNaN(cmpMs)) {
          const earliestMs = toEpochMs(group.earliestPublishedAt);
          const latestMs = toEpochMs(group.latestPublishedAt);
          if (Number.isNaN(earliestMs) || cmpMs < earliestMs) {
            group.earliestPublishedAt = cmpPub;
          }
          if (Number.isNaN(latestMs) || cmpMs > latestMs) {
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
   * Delegates to the standalone saveNewsAnalysis() function.
   */
  public saveAnalysis(title: string, content: string, type: "analyses" | "summaries"): string {
    return saveNewsAnalysis(this.dataPath, title, content, type);
  }
}
