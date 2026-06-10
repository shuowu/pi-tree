import { Hono } from "hono";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { RssService, type FeedConfig } from "../services/rss.service.js";

export const newsRoutes = new Hono();
const rssService = new RssService();

const dataPath =
  process.env.DATA_PATH ??
  join(os.homedir(), ".local", "share", "pi-tree");

// Ensure report directories exist
async function ensureReportDirs() {
  const analysesDir = join(dataPath, "news", "analyses");
  const summariesDir = join(dataPath, "news", "summaries");
  if (!existsSync(analysesDir)) {
    await mkdir(analysesDir, { recursive: true });
  }
  if (!existsSync(summariesDir)) {
    await mkdir(summariesDir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Feed Management Routes
// ---------------------------------------------------------------------------

/** List all feeds from DB */
newsRoutes.get("/feeds", async (c) => {
  try {
    const feeds = rssService.listFeeds();
    return c.json(feeds);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** Add a new feed */
newsRoutes.post("/feeds", async (c) => {
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
newsRoutes.delete("/feeds/:id", async (c) => {
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

// ---------------------------------------------------------------------------
// Crawling & Processing Routes
// ---------------------------------------------------------------------------

/** Trigger crawl on all feeds */
newsRoutes.post("/crawl", async (c) => {
  try {
    const stats = await rssService.crawlAllFeeds();
    return c.json({ success: true, stats });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** Aggregate & Deduplicate RSS Feed Items */
newsRoutes.get("/aggregate", async (c) => {
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

/** List all generated reports in local filesystem */
newsRoutes.get("/reports", async (c) => {
  try {
    await ensureReportDirs();
    const analysesDir = join(dataPath, "news", "analyses");
    const summariesDir = join(dataPath, "news", "summaries");

    const analysesFiles = await readdir(analysesDir);
    const summariesFiles = await readdir(summariesDir);

    return c.json({
      analyses: analysesFiles.filter((f) => f.endsWith(".md")),
      summaries: summariesFiles.filter((f) => f.endsWith(".md"))
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/** Get raw Markdown content of a specific report */
newsRoutes.get("/reports/:type/:filename", async (c) => {
  try {
    const type = c.req.param("type"); // "analyses" or "summaries"
    const filename = c.req.param("filename");

    if (type !== "analyses" && type !== "summaries") {
      return c.json({ success: false, error: "Invalid report type. Must be 'analyses' or 'summaries'" }, 400);
    }
    if (!filename.endsWith(".md") || filename.includes("/") || filename.includes("..")) {
      return c.json({ success: false, error: "Invalid filename" }, 400);
    }

    const filePath = join(dataPath, "news", type, filename);
    if (!existsSync(filePath)) {
      return c.json({ success: false, error: "Report not found" }, 404);
    }

    const content = await readFile(filePath, "utf-8");
    return c.json({ success: true, content });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
