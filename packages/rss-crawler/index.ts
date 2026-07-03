import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { RssService, type FeedConfig } from "pi-tree-news/rss-service";
import { getNewsDb, rssFeeds } from "pi-tree-news/db";
import { desc } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3948);
const DATA_DIR = process.env.DATA_DIR ?? join(homedir(), ".local/share/pi-tree-crawler");
const RSS_API_KEY = process.env.RSS_API_KEY;
const CRAWL_INTERVAL_MIN = Number(process.env.RSS_CRAWL_INTERVAL_MIN ?? 15);

mkdirSync(DATA_DIR, { recursive: true });

console.log(`📡 RSS Crawler starting...`);
console.log(`   Data directory: ${DATA_DIR}`);
console.log(`   Crawl interval: ${CRAWL_INTERVAL_MIN}min`);
console.log(`   Auth: ${RSS_API_KEY ? "enabled" : "disabled (set RSS_API_KEY to secure)"}`);

// ---------------------------------------------------------------------------
// Service Setup
// ---------------------------------------------------------------------------

const rssService = new RssService({
  dataDir: DATA_DIR,
  dataPath: DATA_DIR,
  // sources is omitted — standalone mode, no core sources table
});

// Seed default feeds on first run
await rssService.seedDefaultFeeds();

// ---------------------------------------------------------------------------
// Hono App
// ---------------------------------------------------------------------------

const app = new Hono();

// Optional bearer token auth middleware
if (RSS_API_KEY) {
  app.use("/api/*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${RSS_API_KEY}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
}

// Health check (no auth required)
app.get("/health", async (c) => {
  try {
    const db = await getNewsDb(DATA_DIR);
    const feeds = await rssService.listFeeds();
    const latest = await db.select({ lastFetch: rssFeeds.lastFetchTime })
      .from(rssFeeds)
      .orderBy(desc(rssFeeds.lastFetchTime))
      .limit(1)
      .all();
    return c.json({
      status: "ok",
      feeds: feeds.length,
      lastCrawl: latest[0]?.lastFetch ?? null,
      crawlIntervalMin: CRAWL_INTERVAL_MIN,
    });
  } catch (err: any) {
    return c.json({ status: "error", error: err.message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Feed Management
// ---------------------------------------------------------------------------

app.get("/api/feeds", async (c) => {
  const feeds = await rssService.listFeeds();
  return c.json(feeds);
});

app.post("/api/feeds", async (c) => {
  const body = await c.req.json<{
    id: string; name: string; url: string; tags?: string[];
  }>();
  if (!body.id || !body.name || !body.url) {
    return c.json({ success: false, error: "Missing required fields: id, name, url" }, 400);
  }
  const feed: FeedConfig = {
    id: body.id.toLowerCase().replace(/[^a-z0-9-_]/g, ""),
    name: body.name,
    url: body.url,
    tags: body.tags ?? [],
  };
  await rssService.addFeed(feed);
  return c.json({ success: true, feed });
});

app.put("/api/feeds/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; url?: string; tags?: string[] }>();
  const updated = await rssService.updateFeed(id, body);
  if (!updated) return c.json({ success: false, error: `Feed '${id}' not found` }, 404);
  return c.json({ success: true, id });
});

app.delete("/api/feeds/:id", async (c) => {
  const id = c.req.param("id");
  const deleted = await rssService.removeFeed(id);
  if (!deleted) return c.json({ success: false, error: `Feed '${id}' not found` }, 404);
  return c.json({ success: true, id });
});

app.get("/api/tags", async (c) => {
  const tags = await rssService.getAllFeedTags();
  return c.json(tags);
});

// ---------------------------------------------------------------------------
// Crawl & Query
// ---------------------------------------------------------------------------

app.post("/api/crawl", async (c) => {
  const stats = await rssService.crawlAllFeeds();
  return c.json({ success: true, stats });
});

app.get("/api/items", async (c) => {
  const feedsParam = c.req.query("feeds");
  const tagsParam = c.req.query("tags");
  const items = await rssService.getLatestRss({
    feeds: feedsParam ? feedsParam.split(",") : undefined,
    tags: tagsParam ? tagsParam.split(",") : undefined,
    days: c.req.query("days") ? Number(c.req.query("days")) : undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    keyword: c.req.query("keyword") || undefined,
  });
  return c.json(items);
});

app.get("/api/aggregate", async (c) => {
  const feedsParam = c.req.query("feeds");
  const tagsParam = c.req.query("tags");
  const groups = await rssService.aggregateRss({
    feeds: feedsParam ? feedsParam.split(",") : undefined,
    tags: tagsParam ? tagsParam.split(",") : undefined,
    days: c.req.query("days") ? Number(c.req.query("days")) : undefined,
    similarityThreshold: c.req.query("similarityThreshold") ? Number(c.req.query("similarityThreshold")) : undefined,
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    includeUrl: c.req.query("includeUrl") !== "false",
  });
  return c.json(groups);
});

// ---------------------------------------------------------------------------
// Crawl Loop
// ---------------------------------------------------------------------------

const crawlIntervalMs = CRAWL_INTERVAL_MIN * 60 * 1000;

// Initial crawl check
rssService.checkAndCrawlIfStale(crawlIntervalMs)
  .catch((err) => console.error("[crawler] Startup crawl failed:", err));

// Periodic crawl
setInterval(() => {
  rssService.crawlAllFeeds()
    .then((stats) => {
      const fetched = stats.reduce((acc, s) => acc + s.itemsFetched, 0);
      console.log(`⏰ [crawler] Crawl complete: ${fetched} new items`);
    })
    .catch((err) => console.error("[crawler] Scheduled crawl failed:", err));
}, crawlIntervalMs);

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`🚀 RSS Crawler running on http://0.0.0.0:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
