import { useState, useEffect } from "react";
import type { ContentPanelProps } from "@pi-tree/ui";
import "./ContentPanel.css";

interface SourceData {
  id: string;
  title: string;
  author: string;
  metadata?: {
    youtubeUrl?: string;
    videoId?: string;
    thumbnailUrl?: string;
    lengthSeconds?: number;
    publishDate?: string;
    viewCount?: number;
  };
}

interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

interface GroupedSegment {
  start: number;
  timestamp: string;
  text: string;
}

const VIDEO_ID_RE =
  /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
const BARE_ID_RE = /^([a-zA-Z0-9_-]{11})$/;

function extractVideoId(url: string): string | null {
  const m1 = url.match(VIDEO_ID_RE);
  if (m1) return m1[1];
  const m2 = url.match(BARE_ID_RE);
  if (m2) return m2[1];
  return null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function groupSegments(segments: TranscriptSegment[]): GroupedSegment[] {
  if (!segments || segments.length === 0) return [];
  const INTERVAL = 30; // seconds
  const result: GroupedSegment[] = [];
  let currentGroup: string[] = [];
  let groupStart = 0;

  for (const seg of segments) {
    const interval = Math.floor(seg.start / INTERVAL) * INTERVAL;
    if (interval !== groupStart && currentGroup.length > 0) {
      result.push({
        start: groupStart,
        timestamp: formatDuration(groupStart),
        text: currentGroup.join(" "),
      });
      currentGroup = [];
      groupStart = interval;
    }
    if (currentGroup.length === 0) {
      groupStart = interval;
    }
    currentGroup.push(seg.text);
  }
  if (currentGroup.length > 0) {
    result.push({
      start: groupStart,
      timestamp: formatDuration(groupStart),
      text: currentGroup.join(" "),
    });
  }
  return result;
}

export function YouTubeContentPanel({ sourceId }: ContentPanelProps) {
  const [source, setSource] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Transcript state
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(true);
  const [errorTranscript, setErrorTranscript] = useState<string | null>(null);

  // Playback/Seek state
  const [activeStart, setActiveStart] = useState<number | null>(null);
  const [seekTrigger, setSeekTrigger] = useState(0);

  const seekTo = (start: number) => {
    setActiveStart(start);
    setSeekTrigger((prev) => prev + 1);
  };

  // 1. Fetch Source Metadata
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/library/sources/${sourceId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Parse metadata if it's a JSON string
        if (typeof data.metadata === "string") {
          try {
            data.metadata = JSON.parse(data.metadata);
          } catch {
            // ignore
          }
        }
        if (!cancelled) setSource(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  // 2. Fetch Transcript with Polling Fallback (up to 5 retries)
  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let retries = 0;
    const MAX_RETRIES = 5;

    async function fetchTranscript() {
      try {
        const res = await fetch(`/api/youtube/transcript?sourceId=${encodeURIComponent(sourceId)}`);
        if (res.status === 404) {
          retries++;
          if (retries >= MAX_RETRIES) {
            if (!cancelled) {
              setLoadingTranscript(false);
              setErrorTranscript("Failed to find or fetch captions. Eager load timed out.");
            }
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            return true; // Stop polling
          }
          return false; // Keep polling
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!cancelled) {
          setSegments(data.segments || []);
          setLoadingTranscript(false);
          setErrorTranscript(null);
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
        return true;
      } catch (err) {
        retries++;
        if (retries >= MAX_RETRIES) {
          if (!cancelled) {
            setLoadingTranscript(false);
            setErrorTranscript(err instanceof Error ? err.message : "Failed to load transcript");
          }
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          return true; // Stop polling
        }
        return false;
      }
    }

    // Try immediately
    fetchTranscript().then((success) => {
      if (!success && !cancelled) {
        // Fallback to polling every 3 seconds until loaded or max retries hit
        pollInterval = setInterval(() => {
          fetchTranscript();
        }, 3000);
      }
    });

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [sourceId]);

  if (loading) {
    return (
      <div className="yt-panel">
        <div className="yt-loading">Loading video…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="yt-panel">
        <div className="yt-error">{error}</div>
      </div>
    );
  }
  if (!source) return null;

  const youtubeUrl = source.metadata?.youtubeUrl;
  const videoId = youtubeUrl
    ? extractVideoId(youtubeUrl)
    : source.metadata?.videoId ?? null;

  if (!videoId) {
    return (
      <div className="yt-panel">
        <div className="yt-no-video">
          No YouTube video URL found for this source.
        </div>
      </div>
    );
  }

  const grouped = groupSegments(segments);

  const playerSrc = activeStart !== null
    ? `https://www.youtube.com/embed/${videoId}?start=${activeStart}&autoplay=1&seek=${seekTrigger}`
    : `https://www.youtube.com/embed/${videoId}`;

  return (
    <div className="yt-panel">
      {/* Pinned Video Section */}
      <div className="yt-pinned-section">
        <div className="yt-player-wrapper" key={`${videoId}-${seekTrigger}`}>
          <iframe
            className="yt-player"
            src={playerSrc}
            title={source.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <div className="yt-info">
          <h3 className="yt-title">{source.title}</h3>
          {source.author && <p className="yt-channel">{source.author}</p>}
          <div className="yt-meta">
            {source.metadata?.lengthSeconds != null &&
              source.metadata.lengthSeconds > 0 && (
                <span className="yt-duration">
                  {formatDuration(source.metadata.lengthSeconds)}
                </span>
              )}
            {source.metadata?.publishDate && (
              <span className="yt-date">{source.metadata.publishDate}</span>
            )}
            {source.metadata?.viewCount != null &&
              source.metadata.viewCount > 0 && (
                <span className="yt-views">
                  {source.metadata.viewCount.toLocaleString()} views
                </span>
              )}
          </div>
        </div>
      </div>

      {/* Scrollable Transcript Section */}
      <div className="yt-transcript-section">
        <h4 className="yt-transcript-header">Transcript</h4>
        <div className="yt-transcript-scroll">
          {loadingTranscript ? (
            <div className="yt-transcript-status">
              <span className="yt-loading-spinner" />
              Waiting for transcript (AI is loading)...
            </div>
          ) : errorTranscript ? (
            <div className="yt-transcript-status yt-transcript-error">
              {errorTranscript}
            </div>
          ) : grouped.length === 0 ? (
            <div className="yt-transcript-status">
              No transcript available for this video.
            </div>
          ) : (
            grouped.map((group, idx) => (
              <div
                key={idx}
                className="yt-transcript-paragraph"
                onClick={() => seekTo(group.start)}
              >
                <button className="yt-timestamp">{group.timestamp}</button>
                <span className="yt-transcript-text">{group.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
