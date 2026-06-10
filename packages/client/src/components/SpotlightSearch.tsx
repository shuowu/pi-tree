import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import type { Source, RecentSession } from "@pi-tree/shared";
import { fetchSources, fetchRecentSessions } from "../api";
import { getSourceTypeConfig } from "../source-types";
import {
  Search, X, Clock, ArrowRight, MessageSquare,
  BookOpen, Plus, Rss, Settings,
} from "lucide-react";
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

interface CommandItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  action: () => void;
}

interface SpotlightSearchProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onAddSource?: () => void;
  onManageFeeds?: () => void;
  onSettings?: () => void;
}

type ResultItem =
  | { kind: "source"; source: Source }
  | { kind: "session"; session: RecentSession }
  | { kind: "command"; command: CommandItem };

export function SpotlightSearch({
  userId, isOpen, onClose,
  onAddSource, onManageFeeds, onSettings,
}: SpotlightSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // Static command actions
  const commands: CommandItem[] = useMemo(() => [
    { id: "goto-library", label: "Go to Library", icon: BookOpen, action: () => { onClose(); navigate("/library"); } },
    ...(onAddSource ? [{ id: "add-source", label: "Add Source", icon: Plus, action: () => { onClose(); onAddSource(); } }] : []),
    ...(onManageFeeds ? [{ id: "manage-feeds", label: "Manage Feeds", icon: Rss, action: () => { onClose(); onManageFeeds(); } }] : []),
    ...(onSettings ? [{ id: "settings", label: "Settings", icon: Settings, action: () => { onClose(); onSettings(); } }] : []),
  ], [navigate, onClose, onAddSource, onManageFeeds, onSettings]);

  // Filter commands by query
  const filteredCommands: ResultItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    return matched.map((c) => ({ kind: "command" as const, command: c }));
  }, [query, commands]);

  // Merge search results + commands into a flat list for keyboard navigation
  const allItems: ResultItem[] = useMemo(() => [
    ...results,
    ...filteredCommands,
  ], [results, filteredCommands]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  const activateItem = useCallback(
    (item: ResultItem) => {
      if (item.kind === "command") {
        item.command.action();
      } else {
        onClose();
        if (item.kind === "session") {
          navigate(`/source/${item.session.sourceId}?session=${item.session.sessionId}`);
        } else {
          navigate(`/source/${item.source.id}`);
        }
      }
    },
    [navigate, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && allItems[selectedIndex]) {
        e.preventDefault();
        activateItem(allItems[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [allItems, selectedIndex, activateItem, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = document.querySelector(".spotlight-result.selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const hasAnyResults = allItems.length > 0;

  /** Render a single result row given the item and its index in allItems */
  const renderItem = (item: ResultItem, i: number) => {
    if (item.kind === "session") {
      const config = getSourceTypeConfig(item.session.sourceType);
      return (
        <button
          key={`s-${item.session.sessionId}`}
          className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
          onClick={() => activateItem(item)}
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
    }
    if (item.kind === "source") {
      const config = getSourceTypeConfig(item.source.type);
      const Icon = config.icon;
      return (
        <button
          key={`b-${item.source.id}`}
          className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
          onClick={() => activateItem(item)}
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
    // command
    const CmdIcon = item.command.icon;
    return (
      <button
        key={`cmd-${item.command.id}`}
        className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
        onClick={() => activateItem(item)}
        onMouseEnter={() => setSelectedIndex(i)}
      >
        <div className="spotlight-result-icon command">
          <CmdIcon size={16} />
        </div>
        <div className="spotlight-result-text">
          <span className="spotlight-result-title">{item.command.label}</span>
        </div>
        <ArrowRight size={14} className="spotlight-result-arrow" />
      </button>
    );
  };

  return (
    <div className="spotlight-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="spotlight-modal">
        <div className="spotlight-input-row">
          <Search size={18} className="spotlight-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="spotlight-input"
            placeholder="Search sources, sessions, and actions…"
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

        {hasAnyResults && (
          <div className="spotlight-results">
            {/* Search / recent results section */}
            {results.length > 0 && (
              <>
                {!query.trim() && (
                  <div className="spotlight-section-label">
                    <Clock size={12} /> Recent
                  </div>
                )}
                {results.map((item, i) => renderItem(item, i))}
              </>
            )}

            {/* Commands section */}
            {filteredCommands.length > 0 && (
              <>
                <div className="spotlight-section-label">Actions</div>
                {filteredCommands.map((item, i) =>
                  renderItem(item, results.length + i),
                )}
              </>
            )}
          </div>
        )}

        {loading && allItems.length === 0 && (
          <div className="spotlight-empty">Searching…</div>
        )}

        {!loading && query.trim() && allItems.length === 0 && (
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
