import { useCallback, useState } from "react";
import type { AddSourceFormProps } from "@pi-tree/ui";
import "./YouTubeAddSourceForm.css";

interface ResolvedVideo {
  videoId: string;
  title: string;
  author: string;
  description: string;
  lengthSeconds: number;
  publishDate: string;
  viewCount: number;
  thumbnailUrl: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const YT_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/(?:embed|v|shorts)\/)([a-zA-Z0-9_-]{11})/;

function looksLikeYouTubeUrl(input: string): boolean {
  return YT_URL_RE.test(input.trim());
}

/**
 * YouTube add-source form: just a URL field.
 * On paste/blur, auto-fetches video metadata and shows a preview.
 * The user confirms to add the source.
 */
export function YouTubeAddSourceForm({ onSuccess, onError }: AddSourceFormProps) {
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedVideo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const resolve = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || !looksLikeYouTubeUrl(trimmed)) return;
    if (resolving) return;

    setResolving(true);
    setResolved(null);
    try {
      const res = await fetch(`/api/youtube/resolve?url=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to resolve" }));
        onError(data.error || `Failed to resolve video (${res.status})`);
        return;
      }
      const data: ResolvedVideo = await res.json();
      setResolved(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to resolve video");
    } finally {
      setResolving(false);
    }
  }, [resolving, onError]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (looksLikeYouTubeUrl(pasted)) {
      // Let the state update, then resolve
      setTimeout(() => resolve(pasted), 50);
    }
  }, [resolve]);

  const handleBlur = useCallback(() => {
    if (url.trim() && !resolved && !resolving) {
      resolve(url);
    }
  }, [url, resolved, resolving, resolve]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (resolved && !submitting) {
        handleSubmit();
      } else if (!resolved && !resolving && url.trim()) {
        resolve(url);
      }
    }
  }, [url, resolved, resolving, submitting]);

  const handleSubmit = useCallback(async () => {
    if (!resolved || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/library/sources/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: resolved.title,
          author: resolved.author,
          type: "youtube",
          metadata: {
            videoId: resolved.videoId,
            youtubeUrl: `https://www.youtube.com/watch?v=${resolved.videoId}`,
            thumbnailUrl: resolved.thumbnailUrl,
            lengthSeconds: resolved.lengthSeconds,
            publishDate: resolved.publishDate,
            viewCount: resolved.viewCount,
            description: resolved.description,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Creation failed" }));
        throw new Error(err.error || `Creation failed: ${res.status}`);
      }
      const created: { id: string } = await res.json();
      onSuccess(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add video");
      setSubmitting(false);
    }
  }, [resolved, submitting, onSuccess, onError]);

  return (
    <>
      <div className="add-source-form">
        <div className="add-source-field">
          <label htmlFor="yt-url-input">YouTube URL</label>
          <input
            id="yt-url-input"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setResolved(null);
            }}
            onPaste={handlePaste}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="https://www.youtube.com/watch?v=..."
            autoFocus
          />
        </div>

        {resolving && (
          <div className="yt-add-resolving">
            <span className="yt-add-spinner" />
            Fetching video info…
          </div>
        )}

        {resolved && (
          <div className="yt-add-preview">
            <img
              className="yt-add-thumb"
              src={resolved.thumbnailUrl}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="yt-add-meta">
              <span className="yt-add-title">{resolved.title}</span>
              <span className="yt-add-channel">{resolved.author}</span>
              <span className="yt-add-details">
                {resolved.lengthSeconds > 0 && formatDuration(resolved.lengthSeconds)}
                {resolved.viewCount > 0 && ` · ${resolved.viewCount.toLocaleString()} views`}
                {resolved.publishDate && ` · ${resolved.publishDate}`}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="add-source-actions">
        <button
          className="add-source-submit"
          disabled={!resolved || submitting}
          onClick={handleSubmit}
        >
          {submitting ? (
            <>
              <span className="yt-add-spinner" />
              Adding…
            </>
          ) : (
            "Add Video"
          )}
        </button>
      </div>
    </>
  );
}
