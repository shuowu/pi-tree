import { Type } from "typebox";
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";
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
    const sources = services.sources.list({ type: "youtube" });
    for (const item of sources) {
      try {
        const s = services.sources.get(item.id);
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

      return {
        content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }],
        details: undefined,
      };
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

      return {
        content: [{ type: "text", text: header + formatted }],
        details: undefined,
      };
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
      const source = services.sources.get(params.sourceId);
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                videoDetails: info,
                transcriptInfo: `Transcript${transcriptSource} has ${segments.length} segments.`,
                transcript: formattedTranscript,
              },
              null,
              2,
            ),
          },
        ],
        details: undefined,
      };
    },
  });
});
