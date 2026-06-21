import { Hono } from "hono";
import { RssService, type FeedConfig } from "./rss-service.js";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { closeNewsDb } from "./db.js";
import type { PluginRouteContext, PluginSetupResult } from "@pi-tree/plugin-sdk";

export function setup(ctx: PluginRouteContext): PluginSetupResult {
  const rssService = new RssService({
    dataDir: ctx.dataDir,
    dataPath: ctx.dataPath,
    sources: ctx.sources,
  });

  // Seed default feeds on first run
  try {
    rssService.seedDefaultFeeds();
    console.log("✅ [news] RSS feeds initialized.");
  } catch (err) {
    console.error("❌ [news] Failed to seed default feeds:", err);
  }

  // RSS cron scheduling
  let crawlInterval: ReturnType<typeof setInterval> | undefined;
  if (process.env.PI_MOCK !== "true") {
    const crawlIntervalMin = Number(process.env.RSS_CRAWL_INTERVAL_MIN ?? 30);
    const crawlIntervalMs = crawlIntervalMin * 60 * 1000;

    // Startup crawl check
    rssService.checkAndCrawlIfStale(crawlIntervalMs);

    // Background interval
    crawlInterval = setInterval(() => {
      rssService.crawlAllFeeds()
        .then((stats) => {
          const fetched = stats.reduce((acc, s) => acc + s.itemsFetched, 0);
          if (fetched > 0) console.log(`⏰ [news] Crawl: ${fetched} new items.`);
        })
        .catch((err) => console.error("[news] Scheduled crawl failed:", err));
    }, crawlIntervalMs);
  }

  const routes = new Hono();

  // ---------------------------------------------------------------------------
  // Feed Management Routes
  // ---------------------------------------------------------------------------

  /** List all feeds from DB */
  routes.get("/feeds", (c) => {
    try {
      const feeds = rssService.listFeeds();
      return c.json(feeds);
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  /** Add a new feed */
  routes.post("/feeds", async (c) => {
    try {
      const body = await c.req.json<{
        id: string;
        name: string;
        url: string;
        tags: string[];
      }>();

      if (!body.id || !body.name || !body.url) {
        return c.json({ success: false, error: "Missing required fields: id, name, url" }, 400);
      }

      const feeds = rssService.listFeeds();
      if (feeds.some((f) => f.id === body.id)) {
        return c.json({ success: false, error: `Feed with ID '${body.id}' already exists` }, 400);
      }

      const newFeed: FeedConfig = {
        id: body.id.toLowerCase().replace(/[^a-z0-9-_]/g, ""),
        name: body.name,
        url: body.url,
        tags: body.tags || []
      };

      rssService.addFeed(newFeed);
      return c.json({ success: true, feed: newFeed });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  /** Delete a feed */
  routes.delete("/feeds/:id", (c) => {
    try {
      const id = c.req.param("id");
      const deleted = rssService.removeFeed(id);

      if (!deleted) {
        return c.json({ success: false, error: `Feed with ID '${id}' not found` }, 404);
      }

      return c.json({ success: true, id });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  /** Update a feed */
  routes.put("/feeds/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{
        name?: string;
        url?: string;
        tags?: string[];
      }>();

      const updated = rssService.updateFeed(id, body);
      if (!updated) {
        return c.json({ success: false, error: `Feed with ID '${id}' not found` }, 404);
      }

      return c.json({ success: true, id });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Crawling & Processing Routes
  // ---------------------------------------------------------------------------

  /** Trigger crawl on all feeds */
  routes.post("/crawl", async (c) => {
    try {
      const stats = await rssService.crawlAllFeeds();
      return c.json({ success: true, stats });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  /** Aggregate & Deduplicate RSS Feed Items */
  routes.get("/aggregate", async (c) => {
    try {
      const feedsParam = c.req.query("feeds");
      const feeds = feedsParam ? feedsParam.split(",") : undefined;
      const days = c.req.query("days") ? Number(c.req.query("days")) : undefined;
      const threshold = c.req.query("similarityThreshold") ? Number(c.req.query("similarityThreshold")) : undefined;
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

      const groups = await rssService.aggregateRss({
        feeds,
        days,
        similarityThreshold: threshold,
        limit
      });

      return c.json(groups);
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Report / Saved Analysis Routes
  // ---------------------------------------------------------------------------

  /** Ensure report directories exist */
  function ensureReportDirs() {
    const analysesDir = join(ctx.dataPath, "sources", "news", "analyses");
    const summariesDir = join(ctx.dataPath, "sources", "news", "summaries");
    mkdirSync(analysesDir, { recursive: true });
    mkdirSync(summariesDir, { recursive: true });
  }

  /** List all generated reports in local filesystem */
  routes.get("/reports", (c) => {
    try {
      ensureReportDirs();
      const analysesDir = join(ctx.dataPath, "sources", "news", "analyses");
      const summariesDir = join(ctx.dataPath, "sources", "news", "summaries");

      const analysesFiles = readdirSync(analysesDir);
      const summariesFiles = readdirSync(summariesDir);

      return c.json({
        analyses: analysesFiles.filter((f) => f.endsWith(".md")),
        summaries: summariesFiles.filter((f) => f.endsWith(".md"))
      });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  /** Get raw Markdown content of a specific report */
  routes.get("/reports/:type/:filename", (c) => {
    try {
      const type = c.req.param("type"); // "analyses" or "summaries"
      const filename = c.req.param("filename");

      if (type !== "analyses" && type !== "summaries") {
        return c.json({ success: false, error: "Invalid report type. Must be 'analyses' or 'summaries'" }, 400);
      }
      if (!filename.endsWith(".md") || filename.includes("/") || filename.includes("..")) {
        return c.json({ success: false, error: "Invalid filename" }, 400);
      }

      const filePath = join(ctx.dataPath, "sources", "news", type, filename);
      if (!existsSync(filePath)) {
        return c.json({ success: false, error: "Report not found" }, 404);
      }

      const content = readFileSync(filePath, "utf-8");
      return c.json({ success: true, content });
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500);
    }
  });

  return {
    routes,
    cleanup: () => {
      if (crawlInterval) clearInterval(crawlInterval);
      closeNewsDb();
    },
  };
}
