import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
  RssService,
  calculateSequenceSimilarity,
  calculateJaccardSimilarity,
  detectItemTag,
  toEpochMs,
  toIsoOrNull
} from "../rss-service.ts";
import { resetNewsDb, getNewsDb, rssItems } from "../db.ts";
import type { SourceService, SourceInfo, CreateSourceInput } from "@pi-tree/plugin-sdk";

/**
 * Minimal mock SourceService — stores sources in memory for testing.
 */
function createMockSourceService(): { service: SourceService; close: () => void } {
  const store = new Map<string, SourceInfo>();

  const service: SourceService = {
    list: () => [...store.values()].map(s => ({ id: s.id, type: s.type, title: s.title, author: s.author, year: s.year })),
    get: (id) => store.get(id) ?? null,
    create: (input: CreateSourceInput) => {
      if (!store.has(input.id)) {
        const info: SourceInfo = {
          id: input.id,
          type: input.type,
          title: input.title,
          author: input.author ?? "",
          year: input.year ?? null,
          source: input.source,
          status: input.status,
          metadata: input.metadata,
          coverUrl: input.coverUrl,
        };
        store.set(input.id, info);
      }
      return store.get(input.id)!;
    },
    update: (id, fields) => {
      const existing = store.get(id);
      if (existing) {
        store.set(id, { ...existing, ...fields } as SourceInfo);
      }
    },
  };

  return { service, close: () => {} };
}

describe("Similarity Helper Functions", () => {
  it("should calculate Jaccard similarity correctly", () => {
    // Perfect overlap
    expect(calculateJaccardSimilarity("Apple iPhone 15 launch", "Apple iPhone 15 launch")).toBe(1.0);
    // Partial overlap
    const sim1 = calculateJaccardSimilarity("OpenAI releases GPT-5", "OpenAI launches GPT-5");
    expect(sim1).toBeGreaterThan(0.5);
    expect(sim1).toBeLessThan(1.0);
    // Case insensitivity
    expect(calculateJaccardSimilarity("OPENAI", "openai")).toBe(1.0);
  });

  it("should calculate sequence similarity correctly", () => {
    // Perfect match
    expect(calculateSequenceSimilarity("OpenAI GPT-5 is coming", "OpenAI GPT-5 is coming")).toBe(1.0);
    // Partial match
    const sim = calculateSequenceSimilarity("Apple releases new iOS update", "Apple launches new iOS updates");
    expect(sim).toBeGreaterThan(0.7);
    expect(sim).toBeLessThan(1.0);
  });
});

describe("Date helpers", () => {
  it("parses RFC-822 and ISO to the same epoch ms", () => {
    const rfc = "Wed, 24 Jun 2026 23:57:37 GMT";
    const iso = "2026-06-24T23:57:37.000Z";
    expect(toEpochMs(rfc)).toBe(toEpochMs(iso));
    expect(toIsoOrNull(rfc)).toBe(iso);
  });

  it("returns NaN/null for empty or unparseable input", () => {
    expect(Number.isNaN(toEpochMs(undefined))).toBe(true);
    expect(Number.isNaN(toEpochMs(""))).toBe(true);
    expect(Number.isNaN(toEpochMs("not a date"))).toBe(true);
    expect(toIsoOrNull(null)).toBeNull();
    expect(toIsoOrNull("not a date")).toBeNull();
  });
});

describe("RssService (plugin-local)", () => {
  let tempDir: string;
  let sourceMock: ReturnType<typeof createMockSourceService>;

  beforeEach(() => {
    tempDir = join(import.meta.dirname, "temp-rss-test");
    mkdirSync(tempDir, { recursive: true });
    sourceMock = createMockSourceService();
  });

  afterEach(async () => {
    await resetNewsDb();
    sourceMock.close();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  function createService() {
    return new RssService({
      dataDir: join(tempDir, "plugins", "news"),
      dataPath: tempDir,
      sources: sourceMock.service,
    });
  }

  it("should seed default feeds on first run", async () => {
    const rssService = createService();
    await rssService.seedDefaultFeeds();
    const feeds = await rssService.listFeeds();

    expect(feeds).toBeInstanceOf(Array);
    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds[0].id).toBe("hacker-news");
    expect(feeds[0].tags).toContain("tech");
  });

  it("should not re-seed when feeds already exist", async () => {
    const rssService = createService();
    await rssService.seedDefaultFeeds();

    // Add a custom feed
    await rssService.addFeed({
      id: "my-custom-feed",
      name: "My Custom Feed",
      url: "https://example.com/feed.xml",
      tags: ["custom"]
    });

    // Seed again — should not overwrite
    await rssService.seedDefaultFeeds();
    const feeds = await rssService.listFeeds();
    expect(feeds.some(f => f.id === "my-custom-feed")).toBe(true);
  });

  it("should add and remove feeds via DB", async () => {
    const rssService = createService();
    await rssService.seedDefaultFeeds();

    await rssService.addFeed({
      id: "test-feed",
      name: "Test Feed",
      url: "https://example.com/test.xml",
      tags: ["test"]
    });

    let feeds = await rssService.listFeeds();
    expect(feeds.some(f => f.id === "test-feed")).toBe(true);

    const deleted = await rssService.removeFeed("test-feed");
    expect(deleted).toBe(true);

    feeds = await rssService.listFeeds();
    expect(feeds.some(f => f.id === "test-feed")).toBe(false);
  });

  it("should return false when removing non-existent feed", async () => {
    const rssService = createService();
    await rssService.seedDefaultFeeds();
    const deleted = await rssService.removeFeed("non-existent");
    expect(deleted).toBe(false);
  });

  it("should return tags from DB feeds", async () => {
    const rssService = createService();
    await rssService.seedDefaultFeeds();

    const allTags = await rssService.getAllFeedTags();
    expect(allTags).toContain("tech");

    // Add a sports feed
    await rssService.addFeed({
      id: "espn",
      name: "ESPN",
      url: "https://www.espn.com/espn/rss/news",
      tags: ["sports"]
    });

    const updatedTags = await rssService.getAllFeedTags();
    expect(updatedTags).toContain("sports");
    expect(updatedTags).toContain("tech");
  });

  it("should filter feeds by tags", async () => {
    const rssService = createService();
    await rssService.seedDefaultFeeds();

    await rssService.addFeed({
      id: "espn",
      name: "ESPN",
      url: "https://www.espn.com/espn/rss/news",
      tags: ["sports"]
    });

    const sportFeeds = await rssService.getFeedsByTags(["sports"]);
    expect(sportFeeds.length).toBeGreaterThanOrEqual(1);
    expect(sportFeeds.some(f => f.id === "espn")).toBe(true);

    const techFeeds = await rssService.getFeedsByTags(["tech"]);
    expect(techFeeds.length).toBeGreaterThan(0);
    expect(techFeeds.every(f => f.tags.includes("tech"))).toBe(true);
  });

  it("getLatestRss filters by age and sorts newest-first across mixed date formats", async () => {
    const rssService = createService();
    await rssService.addFeed({
      id: "t",
      name: "Test Feed",
      url: "https://example.com/feed.xml",
      tags: ["test"]
    });

    const db = await getNewsDb(join(tempDir, "plugins", "news"));
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const insert = async (url: string, publishedAt: string) => {
      await db.insert(rssItems).values({
        title: url, feedId: "t", url, guid: url,
        publishedAt, summary: "", author: "",
        createdAt: nowIso, updatedAt: nowIso,
      }).run();
    };

    // RFC-822 dates (as stored by rss-parser's pubDate) — the exact format that
    // broke lexicographic comparison. One old, two recent, out of order.
    const oneDayAgo = new Date(now - 24 * 3600 * 1000).toUTCString();
    const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toUTCString();
    await insert("https://example.com/old", "Wed, 30 Sep 2015 00:00:00 +0000");
    await insert("https://example.com/day-ago", oneDayAgo);
    await insert("https://example.com/recent", twoHoursAgo);

    const items = await rssService.getLatestRss({ days: 3 });

    // Old item (>3 days) must be excluded despite RFC-822 vs ISO cutoff mismatch.
    expect(items.map(i => i.url)).not.toContain("https://example.com/old");
    expect(items).toHaveLength(2);
    // Newest-first ordering by parsed timestamp, not lexicographic string sort.
    expect(items[0].url).toBe("https://example.com/recent");
    expect(items[1].url).toBe("https://example.com/day-ago");
  });

  it("detectItemTag classifies URLs", () => {
    expect(detectItemTag("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
    expect(detectItemTag("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(detectItemTag("https://www.youtube.com/shorts/abc123")).toBe("youtube");
    expect(detectItemTag("https://example.com/news/story")).toBe("news");
    expect(detectItemTag("https://notyoutube.example.com/article")).toBe("news");
  });

  it("getLatestRss returns per-item tag and filters by itemTag", async () => {
    const rssService = createService();
    await rssService.addFeed({
      id: "t",
      name: "Test Feed",
      url: "https://example.com/feed.xml",
      tags: ["test"]
    });

    const db = await getNewsDb(join(tempDir, "plugins", "news"));
    const nowIso = new Date().toISOString();
    const insert = async (url: string, tag: string) => {
      await db.insert(rssItems).values({
        title: url, feedId: "t", url, guid: url,
        publishedAt: nowIso, summary: "", author: "", tag,
        createdAt: nowIso, updatedAt: nowIso,
      }).run();
    };
    await insert("https://example.com/story", "news");
    await insert("https://www.youtube.com/watch?v=abc12345678", "youtube");

    const all = await rssService.getLatestRss({ days: 1 });
    expect(all).toHaveLength(2);
    expect(all.every(i => i.tag === "news" || i.tag === "youtube")).toBe(true);
    expect(all.every(i => i.promotedSourceId === null)).toBe(true);

    const videos = await rssService.getLatestRss({ days: 1, itemTag: "youtube" });
    expect(videos).toHaveLength(1);
    expect(videos[0].url).toContain("youtube.com");
  });

  it("updateItem changes tag and promotedSourceId, returns false for missing items", async () => {
    const rssService = createService();
    await rssService.addFeed({
      id: "t",
      name: "Test Feed",
      url: "https://example.com/feed.xml",
      tags: ["test"]
    });

    const db = await getNewsDb(join(tempDir, "plugins", "news"));
    const nowIso = new Date().toISOString();
    await db.insert(rssItems).values({
      title: "story", feedId: "t", url: "https://example.com/story", guid: "g",
      publishedAt: nowIso, summary: "", author: "",
      createdAt: nowIso, updatedAt: nowIso,
    }).run();

    const [item] = await rssService.getLatestRss({ days: 1 });
    expect(item.tag).toBe("news");  // schema default

    expect(await rssService.updateItem(item.id, { tag: "youtube" })).toBe(true);
    expect(await rssService.updateItem(item.id, { promotedSourceId: "my-article" })).toBe(true);

    const [updated] = await rssService.getLatestRss({ days: 1 });
    expect(updated.tag).toBe("youtube");
    expect(updated.promotedSourceId).toBe("my-article");

    // Clearing the promotion link
    expect(await rssService.updateItem(item.id, { promotedSourceId: null })).toBe(true);
    const [cleared] = await rssService.getLatestRss({ days: 1 });
    expect(cleared.promotedSourceId).toBeNull();

    expect(await rssService.updateItem(999999, { tag: "news" })).toBe(false);
  });
});
