import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import type { Source, RecentSession } from "@pi-tree/shared";
import { fetchSources, fetchRecentSessions } from "../api";
import { getSourceTypeConfig } from "../source-types";
import { Search, X, Clock, ArrowRight, MessageSquare } from "lucide-react";
import "./SpotlightSearch.css";

/** Compute a human-readable relative time string from an ISO date */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface SpotlightSearchProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

type ResultItem =
  | { kind: "source"; source: Source }
  | { kind: "session"; session: RecentSession };

export function SpotlightSearch({ userId, isOpen, onClose }: SpotlightSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      // Small delay for CSS transition
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;

    if (!query.trim()) {
      // Show recent sessions when no query
      setLoading(true);
      fetchRecentSessions(userId, { limit: 6 })
        .then((sessions) => {
          setResults(sessions.map((s) => ({ kind: "session", session: s })));
          setSelectedIndex(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const [sources, sessions] = await Promise.all([
          fetchSources({ search: query.trim() }),
          fetchRecentSessions(userId, { limit: 5, search: query.trim() }),
        ]);

        const items: ResultItem[] = [
          ...sessions.map((s) => ({ kind: "session" as const, session: s })),
          ...sources
            .filter((s) => s.type !== "router")
            .map((s) => ({ kind: "source" as const, source: s })),
        ];
        setResults(items);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, isOpen, userId]);

  const navigateToResult = useCallback(
    (item: ResultItem) => {
      onClose();
      if (item.kind === "session") {
        navigate(`/source/${item.session.sourceId}?session=${item.session.sessionId}`);
      } else {
        navigate(`/source/${item.source.id}`);
      }
    },
    [navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        navigateToResult(results[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [results, selectedIndex, navigateToResult, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = document.querySelector(".spotlight-result.selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="spotlight-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="spotlight-modal">
        <div className="spotlight-input-row">
          <Search size={18} className="spotlight-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="spotlight-input"
            placeholder="Search sources and sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button className="spotlight-clear" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
          <kbd className="spotlight-kbd">esc</kbd>
        </div>

        {results.length > 0 && (
          <div className="spotlight-results">
            {!query.trim() && (
              <div className="spotlight-section-label">
                <Clock size={12} /> Recent
              </div>
            )}
            {results.map((item, i) => {
              if (item.kind === "session") {
                const config = getSourceTypeConfig(item.session.sourceType);
                return (
                  <button
                    key={`s-${item.session.sessionId}`}
                    className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
                    onClick={() => navigateToResult(item)}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <div className="spotlight-result-icon session">
                      <MessageSquare size={16} />
                    </div>
                    <div className="spotlight-result-text">
                      <span className="spotlight-result-title">{item.session.sessionTitle}</span>
                      <span className="spotlight-result-meta">
                        <span className="spotlight-result-badge">{config.label}</span>
                        {item.session.sourceTitle} · {timeAgo(item.session.lastActiveAt)}
                      </span>
                    </div>
                    <ArrowRight size={14} className="spotlight-result-arrow" />
                  </button>
                );
              } else {
                const config = getSourceTypeConfig(item.source.type);
                const Icon = config.icon;
                return (
                  <button
                    key={`b-${item.source.id}`}
                    className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
                    onClick={() => navigateToResult(item)}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <div className="spotlight-result-icon source">
                      <Icon size={16} />
                    </div>
                    <div className="spotlight-result-text">
                      <span className="spotlight-result-title">{item.source.title}</span>
                      <span className="spotlight-result-meta">
                        <span className="spotlight-result-badge">{config.label}</span>
                        {item.source.author}{item.source.year ? ` · ${item.source.year}` : ""}
                      </span>
                    </div>
                    <ArrowRight size={14} className="spotlight-result-arrow" />
                  </button>
                );
              }
            })}
          </div>
        )}

        {loading && results.length === 0 && (
          <div className="spotlight-empty">Searching…</div>
        )}

        {!loading && query.trim() && results.length === 0 && (
          <div className="spotlight-empty">No results for "{query}"</div>
        )}

        <div className="spotlight-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
