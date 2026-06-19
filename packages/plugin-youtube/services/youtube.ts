/**
 * YouTube service — extract video info and transcripts from YouTube.
 *
 * Uses the `youtube-transcript` npm package for reliable transcript fetching.
 * Metadata is extracted from YouTube's public page (ytInitialPlayerResponse).
 *
 * Pure service module: no pi-tree imports, no env vars, no fs.
 */

import {
  YoutubeTranscript,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";

// ---------------------------------------------------------------------------
// Video ID extraction
// ---------------------------------------------------------------------------

const VIDEO_ID_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  /^([a-zA-Z0-9_-]{11})$/, // bare video ID
];

export function extractVideoId(input: string): string | null {
  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Check if a string looks like a YouTube URL or video ID.
 */
export function isYouTubeUrl(input: string): boolean {
  return extractVideoId(input) !== null;
}

// ---------------------------------------------------------------------------
// Rate-limit awareness
// ---------------------------------------------------------------------------

/** Minimum delay (ms) between YouTube fetches to avoid rate limiting. */
const MIN_FETCH_INTERVAL_MS = 1500;
let lastFetchTime = 0;

async function rateLimitDelay(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastFetchTime;
  if (elapsed < MIN_FETCH_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_FETCH_INTERVAL_MS - elapsed));
  }
  lastFetchTime = Date.now();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoInfo {
  videoId: string;
  title: string;
  author: string;
  description: string;
  lengthSeconds: number;
  publishDate: string;
  viewCount: number;
  thumbnailUrl: string;
  embedUrl: string;
}

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Fetch video page and extract metadata
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchPlayerResponse(videoId: string): Promise<any> {
  await rateLimitDelay();
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (res.status === 429) {
    throw new Error(
      "YouTube rate limit reached. Please wait a minute before trying again.",
    );
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch YouTube page: HTTP ${res.status}`);
  }
  const html = await res.text();

  // Extract ytInitialPlayerResponse from the page
  const patterns = [
    /var\s+ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s,
    /ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        continue;
      }
    }
  }

  throw new Error(
    "Could not extract player response from YouTube page. The video may be private, age-restricted, or unavailable.",
  );
}

// ---------------------------------------------------------------------------
// Get video info
// ---------------------------------------------------------------------------

export async function getVideoInfo(input: string): Promise<VideoInfo> {
  const videoId = extractVideoId(input);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL or video ID: ${input}`);
  }

  const playerResponse = await fetchPlayerResponse(videoId);
  const details = playerResponse.videoDetails;

  if (!details) {
    throw new Error("No video details found in player response");
  }

  let publishDate = "";
  try {
    publishDate =
      playerResponse.microformat?.playerMicroformatRenderer?.publishDate ?? "";
  } catch {
    // ignore
  }

  return {
    videoId: details.videoId ?? videoId,
    title: details.title ?? "Untitled",
    author: details.author ?? "Unknown",
    description: details.shortDescription ?? "",
    lengthSeconds: parseInt(details.lengthSeconds ?? "0", 10),
    publishDate,
    viewCount: parseInt(details.viewCount ?? "0", 10),
    thumbnailUrl:
      details.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ??
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
  };
}

// ---------------------------------------------------------------------------
// Get transcript (using youtube-transcript package)
// ---------------------------------------------------------------------------

export async function getTranscript(
  input: string,
  lang?: string,
): Promise<TranscriptSegment[]> {
  const videoId = extractVideoId(input);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL or video ID: ${input}`);
  }

  try {
    await rateLimitDelay();
    const rawTranscript = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: lang ?? "en",
    });

    // The package returns offset/duration in inconsistent units:
    // - srv3 format: milliseconds
    // - classic XML format: seconds
    // Detect by checking if values look like ms (> 1000 for a short video)
    const likelyMs =
      rawTranscript.length > 0 &&
      rawTranscript[rawTranscript.length - 1].offset > 1000;
    const divisor = likelyMs ? 1000 : 1;

    return rawTranscript.map((item) => ({
      start: item.offset / divisor,
      duration: item.duration / divisor,
      text: item.text,
    }));
  } catch (err: any) {
    // Handle specific youtube-transcript error types
    if (err instanceof YoutubeTranscriptTooManyRequestError) {
      throw new Error(
        "YouTube rate limit reached. Please wait a minute or two before trying again.",
      );
    }
    if (err instanceof YoutubeTranscriptDisabledError) {
      throw new Error(
        "Transcripts are disabled for this video. The video owner has turned off captions.",
      );
    }
    if (err instanceof YoutubeTranscriptNotAvailableError) {
      throw new Error(
        "No captions available for this video in the requested language.",
      );
    }
    if (err instanceof YoutubeTranscriptVideoUnavailableError) {
      throw new Error(
        "This video is unavailable. It may be private, deleted, or age-restricted.",
      );
    }
    // Generic fallback
    if (err.message?.includes("Too many")) {
      throw new Error(
        "YouTube rate limit reached. Please wait a minute before trying again.",
      );
    }
    throw new Error(`Failed to fetch transcript: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Format transcript for display
// ---------------------------------------------------------------------------

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Format transcript segments into readable text grouped by ~30-second intervals.
 */
export function formatTranscript(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return "No transcript available.";

  const INTERVAL = 30; // seconds
  const lines: string[] = [];
  let currentGroup: string[] = [];
  let groupStart = 0;

  for (const seg of segments) {
    const interval = Math.floor(seg.start / INTERVAL) * INTERVAL;

    if (interval !== groupStart && currentGroup.length > 0) {
      lines.push(`[${formatTimestamp(groupStart)}] ${currentGroup.join(" ")}`);
      currentGroup = [];
      groupStart = interval;
    }

    if (currentGroup.length === 0) {
      groupStart = interval;
    }

    currentGroup.push(seg.text);
  }

  // Flush remaining
  if (currentGroup.length > 0) {
    lines.push(`[${formatTimestamp(groupStart)}] ${currentGroup.join(" ")}`);
  }

  return lines.join("\n\n");
}
