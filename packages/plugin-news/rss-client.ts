import type { IRssService, FeedConfig, CrawlStats, RssItemData, RssItemUpdates, AggregatedRssGroup } from "./rss-service.js";

// ---------------------------------------------------------------------------
// RemoteRssClient — proxies IRssService calls to a remote RSS crawler
// ---------------------------------------------------------------------------

export class RemoteRssClient implements IRssService {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[rss-remote] ${method} ${path} failed: ${res.status} ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Feed Management
  // -------------------------------------------------------------------------

  async listFeeds(): Promise<FeedConfig[]> {
    return this.request("GET", "/api/feeds");
  }

  async addFeed(feed: FeedConfig): Promise<void> {
    await this.request("POST", "/api/feeds", feed);
  }

  async removeFeed(feedId: string): Promise<boolean> {
    const result = await this.request<{ success: boolean }>("DELETE", `/api/feeds/${encodeURIComponent(feedId)}`);
    return result.success;
  }

  async updateFeed(feedId: string, updates: Partial<Pick<FeedConfig, "name" | "url" | "tags">>): Promise<boolean> {
    const result = await this.request<{ success: boolean }>("PUT", `/api/feeds/${encodeURIComponent(feedId)}`, updates);
    return result.success;
  }

  async getFeedsByTags(filterTags: string[]): Promise<FeedConfig[]> {
    const feeds = await this.listFeeds();
    return feeds.filter(f => f.tags.some(t => filterTags.includes(t)));
  }

  async getAllFeedTags(): Promise<string[]> {
    return this.request("GET", "/api/tags");
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  async getLatestRss(options?: {
    feeds?: string[]; tags?: string[]; days?: number; limit?: number; offset?: number; keyword?: string; itemTag?: string;
  }): Promise<RssItemData[]> {
    const params = new URLSearchParams();
    if (options?.feeds?.length) params.set("feeds", options.feeds.join(","));
    if (options?.tags?.length) params.set("tags", options.tags.join(","));
    if (options?.days !== undefined) params.set("days", String(options.days));
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    if (options?.keyword) params.set("keyword", options.keyword);
    if (options?.itemTag) params.set("itemTag", options.itemTag);
    const qs = params.toString();
    return this.request("GET", `/api/items${qs ? `?${qs}` : ""}`);
  }

  async updateItem(itemId: number, updates: RssItemUpdates): Promise<boolean> {
    const result = await this.request<{ success: boolean }>("PATCH", `/api/items/${itemId}`, updates);
    return result.success;
  }

  async aggregateRss(options?: {
    feeds?: string[]; tags?: string[]; days?: number;
    similarityThreshold?: number; limit?: number; includeUrl?: boolean;
  }): Promise<AggregatedRssGroup[]> {
    const params = new URLSearchParams();
    if (options?.feeds?.length) params.set("feeds", options.feeds.join(","));
    if (options?.tags?.length) params.set("tags", options.tags.join(","));
    if (options?.days !== undefined) params.set("days", String(options.days));
    if (options?.similarityThreshold !== undefined) params.set("similarityThreshold", String(options.similarityThreshold));
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.includeUrl !== undefined) params.set("includeUrl", String(options.includeUrl));
    const qs = params.toString();
    return this.request("GET", `/api/aggregate${qs ? `?${qs}` : ""}`);
  }

  // -------------------------------------------------------------------------
  // Crawl
  // -------------------------------------------------------------------------

  async crawlAllFeeds(): Promise<CrawlStats[]> {
    const result = await this.request<{ success: boolean; stats: CrawlStats[] }>("POST", "/api/crawl");
    return result.stats;
  }
}
