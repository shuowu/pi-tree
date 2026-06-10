import "./load-env.js";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import os from "node:os";
import { app } from "./app.js";
import { RssService } from "./services/rss.service.js";
import { getMcpBridge } from "./services/mcp-bridge.js";
import { initAgentRegistry } from "./services/agent-registry.js";
import { setExtensionServices } from "./agents/context.js";
import { getDb, sources, userSessions, users } from "./db/index.js";

const port = Number(process.env.PORT ?? 3847);
const hostname = process.env.HOST ?? "0.0.0.0";
const dataPath = process.env.DATA_PATH ?? join(os.homedir(), ".local", "share", "pi-tree");

// Initialize RSS Service and seed default feeds on first run
const rssService = new RssService();
try {
  rssService.seedDefaultFeeds();
  console.log("✅ RSS feeds initialized.");
} catch (err) {
  console.error("❌ Failed to initialize RSS feeds:", err);
}

// Initialize MCP bridge — connects to external MCP servers if mcp.json exists.
// This must happen before extension services are set, so extensions can access
// discovered MCP tools during registration.
const mcpBridge = getMcpBridge();
const mcpConfigPath = join(dataPath, "mcp.json");
await mcpBridge.connectAll(mcpConfigPath);

// Populate extension services — extensions access server capabilities through
// this locator instead of importing server internals directly.
setExtensionServices({
  db: getDb,
  schema: { sources, userSessions, users },
  rssService,
  ...(mcpBridge.hasServers() ? { mcpBridge } : {}),
});

// Initialize the agent registry — discovers skills, extensions, and validates profiles.
// Must happen after extension services are set.
initAgentRegistry({
  coreAgentsDir: join(import.meta.dirname, "agents"),
  userSkillsDir: process.env.SKILLS_PATH || join(dataPath, "skills"),
  userExtensionsDir: process.env.EXTENSIONS_PATH || join(dataPath, "extensions"),
});

console.log(`🚀 pi-tree server starting on http://${hostname}:${port}`);

// Crawl interval in minutes (default: 30 — fast enough for HN's rolling window)
const crawlIntervalMin = Number(process.env.RSS_CRAWL_INTERVAL_MIN ?? 30);
const crawlIntervalMs = crawlIntervalMin * 60 * 1000;

// Crawl on startup if feeds are stale (no crawl in the last interval)
rssService.getLatestRss({ days: 0, limit: 1 }).then(async () => {
  // Check the most recent lastFetchTime across all feeds
  const { getDb, rssFeeds: rssTable } = await import("./db/index.js");
  const { desc } = await import("drizzle-orm");
  const db = getDb();
  const latest = db.select({ lastFetch: rssTable.lastFetchTime })
    .from(rssTable)
    .orderBy(desc(rssTable.lastFetchTime))
    .limit(1)
    .all();

  const lastFetch = latest[0]?.lastFetch;
  const staleMs = lastFetch ? Date.now() - new Date(lastFetch).getTime() : Infinity;

  if (staleMs > crawlIntervalMs) {
    const reason = lastFetch ? `stale (${Math.round(staleMs / 60000)}min ago)` : "never crawled";
    console.log(`📡 RSS feeds are ${reason}. Crawling in background...`);
    rssService.crawlAllFeeds()
      .then((stats) => {
        const fetched = stats.reduce((acc, s) => acc + s.itemsFetched, 0);
        console.log(`📡 Startup crawl completed: fetched ${fetched} new items.`);
      })
      .catch((err) => console.error("❌ Startup crawl failed:", err));
  } else {
    console.log(`📡 RSS feeds are fresh (last crawl ${Math.round(staleMs / 60000)}min ago). Skipping startup crawl.`);
  }
}).catch((err) => console.error("❌ Failed to check RSS staleness:", err));

// Background crawl interval
setInterval(() => {
  rssService.crawlAllFeeds()
    .then((stats) => {
      const fetched = stats.reduce((acc, s) => acc + s.itemsFetched, 0);
      if (fetched > 0) {
        console.log(`⏰ Scheduled crawl: fetched ${fetched} new items.`);
      }
    })
    .catch((err) => console.error("❌ Scheduled crawl failed:", err));
}, crawlIntervalMs);

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`✅ Server listening on http://${hostname}:${info.port}`);
});
