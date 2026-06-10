import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { existsSync, unlinkSync, rmSync } from "node:fs";
import {
  RssService,
  calculateSequenceSimilarity,
  calculateJaccardSimilarity
} from "../rss.service.js";

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

describe("RssService", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(import.meta.dirname, "temp-rss-test");
    vi.stubEnv("DATA_PATH", tempDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("should initialize default configuration file", () => {
    const rssService = new RssService();
    const config = rssService.getFeedsConfig();

    expect(config).toBeInstanceOf(Array);
    expect(config.length).toBeGreaterThan(0);
    expect(config[0].id).toBe("hacker-news");
    expect(existsSync(join(tempDir, "news", "feeds.json"))).toBe(true);
  });

  it("should support updating and retrieving feed configs", () => {
    const rssService = new RssService();
    const initialConfig = rssService.getFeedsConfig();

    const customFeeds = [
      {
        id: "my-custom-feed",
        name: "My Custom Feed",
        url: "https://example.com/feed.xml",
        tags: ["custom"]
      }
    ];

    rssService.saveFeedsConfig(customFeeds);
    const updatedConfig = rssService.getFeedsConfig();

    expect(updatedConfig.length).toBe(1);
    expect(updatedConfig[0].id).toBe("my-custom-feed");
  });
});
