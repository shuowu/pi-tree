import { Hono } from "hono";
import type { PluginRouteContext, PluginSetupResult } from "@pi-tree/plugin-sdk";
import { getVideoInfo, extractVideoId, getTranscript } from "./services/youtube.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function setup(ctx: PluginRouteContext): PluginSetupResult {
  const app = new Hono();

  /**
   * GET /resolve?url=<youtube-url>
   *
   * Fetches YouTube video metadata for a given URL.
   * Used by the add-source form to auto-populate title/channel.
   */
  app.get("/resolve", async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "url query parameter is required" }, 400);
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return c.json({ error: "Invalid YouTube URL" }, 400);
    }

    try {
      const info = await getVideoInfo(url);
      return c.json({
        videoId: info.videoId,
        title: info.title,
        author: info.author,
        description: info.description.length > 500
          ? info.description.slice(0, 500) + "…"
          : info.description,
        lengthSeconds: info.lengthSeconds,
        publishDate: info.publishDate,
        viewCount: info.viewCount,
        thumbnailUrl: info.thumbnailUrl,
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 422);
    }
  });

  /**
   * GET /transcript?sourceId=<sourceId>
   *
   * Fetches cached transcript segments for a given source ID.
   * Eagerly fetches on-the-fly from YouTube if not cached.
   */
  app.get("/transcript", async (c) => {
    const sourceId = c.req.query("sourceId");
    if (!sourceId) {
      return c.json({ error: "sourceId query parameter is required" }, 400);
    }

    try {
      const sourcePath = join(ctx.dataPath, "sources", sourceId, "transcript.json");
      if (existsSync(sourcePath)) {
        const raw = readFileSync(sourcePath, "utf-8");
        const data = JSON.parse(raw);
        return c.json(data);
      }

      // Fallback 1: Check if there is a cached file in the plugin data dir
      const sourceInfo = ctx.sources.get(sourceId);
      if (sourceInfo) {
        const meta = typeof sourceInfo.metadata === "string"
          ? JSON.parse(sourceInfo.metadata)
          : sourceInfo.metadata;

        const videoId = meta?.videoId;
        if (videoId) {
          const fallbackPath = join(ctx.dataPath, "plugins", "youtube", `${videoId}.json`);
          if (existsSync(fallbackPath)) {
            const raw = readFileSync(fallbackPath, "utf-8");
            const data = JSON.parse(raw);

            // Self-heal: Write it to the correct source folder
            const dir = join(ctx.dataPath, "sources", sourceId);
            const { mkdirSync, writeFileSync } = await import("node:fs");
            mkdirSync(dir, { recursive: true });
            writeFileSync(sourcePath, raw, "utf-8");
            console.log(`[youtube/routes] Self-healed transcript for ${sourceId} from fallback cache.`);

            return c.json(data);
          }

          // Fallback 2: Eagerly fetch from YouTube on-the-fly and cache it
          console.log(`[youtube/routes] Eagerly fetching transcript for ${sourceId} (videoId: ${videoId}) on-the-fly...`);
          try {
            const segments = await getTranscript(videoId);
            const data = { videoId, fetchedAt: new Date().toISOString(), segments };

            // Save to both the source folder and the fallback folder
            const dir = join(ctx.dataPath, "sources", sourceId);
            const fallbackDir = join(ctx.dataPath, "plugins", "youtube");
            const { mkdirSync, writeFileSync } = await import("node:fs");
            mkdirSync(dir, { recursive: true });
            mkdirSync(fallbackDir, { recursive: true });

            const raw = JSON.stringify(data, null, 2);
            writeFileSync(sourcePath, raw, "utf-8");
            writeFileSync(fallbackPath, raw, "utf-8");

            console.log(`[youtube/routes] Successfully fetched and cached transcript for ${sourceId} on-the-fly.`);
            return c.json(data);
          } catch (fetchErr: any) {
            console.warn(`[youtube/routes] Failed to fetch transcript on-the-fly for ${sourceId}:`, fetchErr.message);
            return c.json({ error: `Failed to load transcript: ${fetchErr.message}` }, 404);
          }
        }
      }

      return c.json({ error: "Transcript not yet loaded" }, 404);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return { routes: app, cleanup() {} };
}


