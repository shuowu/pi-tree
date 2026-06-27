import { Type } from "typebox";
import { definePiTreeExtension, textResult, jsonResult, toolError } from "@pi-tree/plugin-sdk";
import {
  extractVideoId,
  getVideoInfo,
  getTranscript,
  formatTranscript,
  type TranscriptSegment,
} from "./services/youtube.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export default definePiTreeExtension((pi, services) => {
  // ---------------------------------------------------------------------------
  // Transcript cache — persists to <DATA_PATH>/sources/<sourceId>/transcript.json
  // Falls back to <DATA_PATH>/plugins/youtube/<videoId>.json for ad-hoc use
  // ---------------------------------------------------------------------------

  async function getTranscriptCachePath(videoId: string): Promise<string> {
    // Check if there's a source with this videoId to use its directory
    const sources = await services.sources.list({ type: "youtube" });
    for (const item of sources) {
      try {
        const s = await services.sources.get(item.id);
        if (!s) continue;
        const meta = typeof s.metadata === "string" ? JSON.parse(s.metadata) : s.metadata;
        if (meta?.videoId === videoId) {
          const dir = join(services.dataPath, "sources", s.id);
          await mkdir(dir, { recursive: true });
          return join(dir, "transcript.json");
        }
      } catch { /* ignore */ }
    }
    // Fallback: plugin data directory
    const dir = services.getPluginDataDir("youtube");
    await mkdir(dir, { recursive: true });
    return join(dir, `${videoId}.json`);
  }

  async function loadCachedTranscript(videoId: string): Promise<TranscriptSegment[] | null> {
    try {
      const path = await getTranscriptCachePath(videoId);
      const raw = await readFile(path, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.segments) && data.segments.length > 0) {
        return data.segments;
      }
    } catch {
      // File doesn't exist or is malformed — cache miss
    }
    return null;
  }

  async function saveCachedTranscript(videoId: string, segments: TranscriptSegment[]): Promise<void> {
    try {
      const path = await getTranscriptCachePath(videoId);
      await writeFile(
        path,
        JSON.stringify({ videoId, fetchedAt: new Date().toISOString(), segments }, null, 2),
        "utf-8",
      );
    } catch {
      // Non-critical — log but don't fail
      console.warn(`[youtube] Failed to cache transcript for ${videoId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Get YouTube Video Info
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "get_youtube_info",
    label: "Get YouTube Info",
    description:
      "Get metadata for a YouTube video: title, channel, description, duration, publish date, view count, and thumbnail.",
    parameters: Type.Object({
      url: Type.String({
        description:
          'YouTube video URL (e.g. "https://www.youtube.com/watch?v=dQw4w9WgXcQ") or bare video ID (e.g. "dQw4w9WgXcQ").',
      }),
    }),
    async execute(_toolCallId, params) {
      const info = await getVideoInfo(params.url);

      const formatted = {
        videoId: info.videoId,
        title: info.title,
        channel: info.author,
        description:
          info.description.length > 500
            ? info.description.slice(0, 500) + "…"
            : info.description,
        duration: `${Math.floor(info.lengthSeconds / 60)}m ${info.lengthSeconds % 60}s`,
        publishDate: info.publishDate,
        viewCount: info.viewCount.toLocaleString(),
        thumbnailUrl: info.thumbnailUrl,
        embedUrl: info.embedUrl,
      };

      return jsonResult(formatted);
    },
  });

  // ---------------------------------------------------------------------------
  // 2. Get YouTube Transcript (with local caching)
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "get_youtube_transcript",
    label: "Get YouTube Transcript",
    description:
      "Get the transcript/captions for a YouTube video. Returns timestamped text grouped into readable paragraphs. Transcripts are cached locally after the first fetch.",
    parameters: Type.Object({
      url: Type.String({
        description:
          'YouTube video URL or bare video ID. Supports youtube.com/watch?v=, youtu.be/, youtube.com/embed/, and youtube.com/shorts/ formats.',
      }),
      lang: Type.Optional(
        Type.String({
          description:
            'Preferred caption language code (e.g. "en", "es", "ja"). Defaults to English if available, otherwise uses first available track.',
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const videoId = extractVideoId(params.url);
      if (!videoId) {
        throw new Error(`Invalid YouTube URL or video ID: ${params.url}`);
      }

      // Try local cache first
      let segments = await loadCachedTranscript(videoId);
      let fromCache = false;

      if (segments) {
        fromCache = true;
      } else {
        // Fetch from YouTube
        segments = await getTranscript(params.url, params.lang);
        // Persist to local storage
        await saveCachedTranscript(videoId, segments);
      }

      const formatted = formatTranscript(segments);
      const source = fromCache ? " (cached)" : "";
      const header = `Transcript for video ${videoId}${source} (${segments.length} segments):\n\n`;

      return textResult(header + formatted);
    },
  });

  // ---------------------------------------------------------------------------
  // 3. Load Video Data (specific session logic)
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "load_video_data",
    label: "Load Video Data",
    description:
      "Load all metadata and transcript for a YouTube source in the library. Looks up the video by source ID, resolves the video ID, and returns both video details and transcript.",
    parameters: Type.Object({
      sourceId: Type.String({
        description:
          "The source ID of the YouTube video (e.g. from Video Source ID in system context).",
      }),
    }),
    async execute(_toolCallId, params) {
      const source = await services.sources.get(params.sourceId);
      if (!source) {
        throw new Error(`Source not found: ${params.sourceId}`);
      }
      const meta =
        typeof source.metadata === "string"
          ? JSON.parse(source.metadata)
          : source.metadata;
      const videoId = meta?.videoId;
      if (!videoId) {
        throw new Error(`No YouTube video ID found in metadata for source: ${params.sourceId}`);
      }

      // Try local cache first for transcript
      let segments = await loadCachedTranscript(videoId);
      let fromCache = false;

      if (segments) {
        fromCache = true;
      } else {
        try {
          segments = await getTranscript(videoId);
          await saveCachedTranscript(videoId, segments);
        } catch (err: any) {
          console.warn(`[youtube] Failed to fetch transcript for ${videoId}:`, err.message);
          segments = [];
        }
      }

      const formattedTranscript = formatTranscript(segments);
      const transcriptSource = fromCache ? " (cached)" : " (fetched on-demand)";

      const info = {
        sourceId: source.id,
        videoId,
        title: source.title,
        author: source.author,
        duration: meta?.lengthSeconds
          ? `${Math.floor(meta.lengthSeconds / 60)}m ${meta.lengthSeconds % 60}s`
          : "unknown",
        publishDate: meta?.publishDate ?? "unknown",
        viewCount: meta?.viewCount?.toLocaleString() ?? "unknown",
        description: meta?.description ?? "",
      };

      return jsonResult({
        videoDetails: info,
        transcriptInfo: `Transcript${transcriptSource} has ${segments.length} segments.`,
        transcript: formattedTranscript,
      });
    },
  });

  // ---------------------------------------------------------------------------
  // 4. Create YouTube Source — auto-create a source from a URL
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "create_youtube_source",
    label: "Create YouTube Source",
    description:
      "Create a new YouTube video source from a URL. Fetches video metadata (title, channel, duration) and adds it to the library. If a source for this video already exists, returns the existing one. Use this when a user pastes a YouTube link in chat.",
    parameters: Type.Object({
      url: Type.String({
        description:
          'YouTube video URL (e.g. "https://www.youtube.com/watch?v=dQw4w9WgXcQ") or video ID.',
      }),
    }),
    async execute(_toolCallId, params) {
      try {
        const videoId = extractVideoId(params.url);
        if (!videoId) {
          throw new Error(
            `Invalid YouTube URL: ${params.url}. Please provide a valid youtube.com or youtu.be link.`,
          );
        }

        // Check if a source for this video already exists
        const existingSources = await services.sources.list({ type: "youtube" });
        for (const s of existingSources) {
          const full = await services.sources.get(s.id);
          const meta = typeof full?.metadata === "string" ? JSON.parse(full.metadata) : full?.metadata;
          if (meta?.videoId === videoId) {
            return {
              content: [{ type: "text", text: JSON.stringify({ sourceId: full!.id, title: full!.title, author: full!.author, alreadyExists: true }, null, 2) }],
              details: undefined,
            };
          }
        }

        // Fetch video metadata using the existing service
        const info = await getVideoInfo(videoId);

        // Generate a slug ID from the video title
        const baseId =
          info.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60) || "youtube-video";

        let sourceIdCandidate = baseId;
        if (await services.sources.get(sourceIdCandidate)) {
          sourceIdCandidate = `${baseId}-${videoId.slice(0, 6)}`;
        }

        // Create source
        const created = await services.sources.create({
          id: sourceIdCandidate,
          title: info.title,
          author: info.author,
          type: "youtube",
          source: "user",
          status: "ready",
          metadata: {
            videoId,
            youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnailUrl: info.thumbnailUrl,
            embedUrl: info.embedUrl,
            lengthSeconds: info.lengthSeconds,
            publishDate: info.publishDate,
            viewCount: info.viewCount,
            description: info.description.slice(0, 1000),
          },
        });

        // Eagerly pre-fetch and cache transcript + thumbnail in the background
        try {
          const segments = await getTranscript(videoId);
          await saveCachedTranscript(videoId, segments);
          console.log(`[youtube/create_youtube_source] Cached transcript for ${created.id}.`);
        } catch (err: any) {
          console.warn(`[youtube/create_youtube_source] Failed to pre-fetch transcript for ${created.id}:`, err.message);
        }

        // Cache the cover thumbnail
        if (info.thumbnailUrl) {
          try {
            const res = await fetch(info.thumbnailUrl);
            if (res.ok) {
              const buffer = await res.arrayBuffer();
              const dir = join(services.dataPath, "sources", created.id);
              await mkdir(dir, { recursive: true });
              await writeFile(join(dir, "cover.jpg"), Buffer.from(buffer));
              console.log(`[youtube/create_youtube_source] Cached cover for ${created.id}.`);
            }
          } catch (coverErr: any) {
            console.warn(`[youtube/create_youtube_source] Failed to cache cover for ${created.id}:`, coverErr.message);
          }
        }

        return jsonResult({
          sourceId: created.id,
          title: info.title,
          author: info.author,
          duration: `${Math.floor(info.lengthSeconds / 60)}m ${info.lengthSeconds % 60}s`,
          alreadyExists: false,
        });
      } catch (err: any) {
        throw toolError("create YouTube source", err);
      }
    },
  });
});
