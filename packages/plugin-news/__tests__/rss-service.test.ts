import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
  RssService,
  calculateSequenceSimilarity,
  calculateJaccardSimilarity
} from "../rss-service.ts";
import { resetNewsDb } from "../db.ts";
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

describe("RssService (plugin-local)", () => {
  let tempDir: string;
  let sourceMock: ReturnType<typeof createMockSourceService>;

  beforeEach(() => {
    tempDir = join(import.meta.dirname, "temp-rss-test");
    mkdirSync(tempDir, { recursive: true });
    sourceMock = createMockSourceService();
  });

  afterEach(() => {
    resetNewsDb();
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

  it("should seed default feeds on first run", () => {
    const rssService = createService();
    rssService.seedDefaultFeeds();
    const feeds = rssService.listFeeds();

    expect(feeds).toBeInstanceOf(Array);
    expect(feeds.length).toBeGreaterThan(0);
    expect(feeds[0].id).toBe("hacker-news");
    expect(feeds[0].tags).toContain("tech");
  });

  it("should not re-seed when feeds already exist", () => {
    const rssService = createService();
    rssService.seedDefaultFeeds();

    // Add a custom feed
    rssService.addFeed({
      id: "my-custom-feed",
      name: "My Custom Feed",
      url: "https://example.com/feed.xml",
      tags: ["custom"]
    });

    // Seed again — should not overwrite
    rssService.seedDefaultFeeds();
    const feeds = rssService.listFeeds();
    expect(feeds.some(f => f.id === "my-custom-feed")).toBe(true);
  });

  it("should add and remove feeds via DB", () => {
    const rssService = createService();
    rssService.seedDefaultFeeds();

    rssService.addFeed({
      id: "test-feed",
      name: "Test Feed",
      url: "https://example.com/test.xml",
      tags: ["test"]
    });

    let feeds = rssService.listFeeds();
    expect(feeds.some(f => f.id === "test-feed")).toBe(true);

    const deleted = rssService.removeFeed("test-feed");
    expect(deleted).toBe(true);

    feeds = rssService.listFeeds();
    expect(feeds.some(f => f.id === "test-feed")).toBe(false);
  });

  it("should return false when removing non-existent feed", () => {
    const rssService = createService();
    rssService.seedDefaultFeeds();
    const deleted = rssService.removeFeed("non-existent");
    expect(deleted).toBe(false);
  });

  it("should return tags from DB feeds", () => {
    const rssService = createService();
    rssService.seedDefaultFeeds();

    const allTags = rssService.getAllFeedTags();
    expect(allTags).toContain("tech");

    // Add a sports feed
    rssService.addFeed({
      id: "espn",
      name: "ESPN",
      url: "https://www.espn.com/espn/rss/news",
      tags: ["sports"]
    });

    const updatedTags = rssService.getAllFeedTags();
    expect(updatedTags).toContain("sports");
    expect(updatedTags).toContain("tech");
  });

  it("should filter feeds by tags", () => {
    const rssService = createService();
    rssService.seedDefaultFeeds();

    rssService.addFeed({
      id: "espn",
      name: "ESPN",
      url: "https://www.espn.com/espn/rss/news",
      tags: ["sports"]
    });

    const sportFeeds = rssService.getFeedsByTags(["sports"]);
    expect(sportFeeds.length).toBeGreaterThanOrEqual(1);
    expect(sportFeeds.some(f => f.id === "espn")).toBe(true);

    const techFeeds = rssService.getFeedsByTags(["tech"]);
    expect(techFeeds.length).toBeGreaterThan(0);
    expect(techFeeds.every(f => f.tags.includes("tech"))).toBe(true);
  });
});
