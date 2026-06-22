import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import type { Source, SourceSession } from "@pi-tree/shared";
import { fetchSources, fetchSessions } from "../api";
import { useSourceMentions, type MentionSuggestion } from "../hooks/useSourceMentions";
import { getSourceTypeConfig } from "../source-types";
import {
  Search, X, Clock, ArrowRight, MessageSquare,
  Plus, Rss, Settings, Hash, BookOpen,
  CornerDownLeft,
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

/** Pick icon component by mention kind + source type */
function MentionIcon({ suggestion }: { suggestion: MentionSuggestion }) {
  if (suggestion.kind === "feed") return <Rss size={16} />;
  if (suggestion.kind === "tag") return <Hash size={16} />;
  if (suggestion.kind === "category") {
    const config = getSourceTypeConfig(suggestion.type ?? "");
    const Icon = config.icon;
    return <Icon size={16} />;
  }
  // source kind — pick by source type
  const config = getSourceTypeConfig(suggestion.type ?? "");
  const Icon = config.icon;
  return <Icon size={16} />;
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
  onSettings?: () => void;
}

type ResultItem =
  | { kind: "source"; source: Source }
  | { kind: "session"; session: SourceSession }
  | { kind: "command"; command: CommandItem }
  | { kind: "mention"; mention: MentionSuggestion }
  | { kind: "action"; action: { id: string; label: string; mode: string; sourceId: string } };

export function SpotlightSearch({
  userId, isOpen, onClose,
  onAddSource, onSettings,
}: SpotlightSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sessionResults, setSessionResults] = useState<ResultItem[]>([]);
  const [sourceResults, setSourceResults] = useState<ResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // @ scope state
  const [scope, setScope] = useState<MentionSuggestion | null>(null);
  const [scopedSessions, setScopedSessions] = useState<ResultItem[]>([]);
  const [scopedSources, setScopedSources] = useState<ResultItem[]>([]);
  const [scopeActions, setScopeActions] = useState<ResultItem[]>([]);
  const { ensureLoaded, filterItems } = useSourceMentions();

  // Detect @ mode: typing starts with @ and no scope is set yet
  const isAtMode = !scope && query.startsWith("@");
  const atQuery = isAtMode ? query.slice(1) : "";

  // Build mention suggestions when in @ mode
  const mentionResults: ResultItem[] = useMemo(() => {
    if (!isAtMode) return [];
    return filterItems(atQuery).map((m) => ({ kind: "mention" as const, mention: m }));
  }, [isAtMode, atQuery, filterItems]);

  // Static command actions
  const commands: CommandItem[] = useMemo(() => [
    { id: "goto-library", label: "Go to Library", icon: BookOpen, action: () => { onClose(); navigate("/library"); } },
    ...(onAddSource ? [{ id: "add-source", label: "Add Source", icon: Plus, action: () => { onClose(); onAddSource(); } }] : []),
    ...(onSettings ? [{ id: "settings", label: "Settings", icon: Settings, action: () => { onClose(); onSettings(); } }] : []),
  ], [navigate, onClose, onAddSource, onSettings]);

  // Filter commands by query — hidden in @ mode and scoped mode
  const filteredCommands: ResultItem[] = useMemo(() => {
    if (isAtMode || scope) return [];
    const q = query.trim().toLowerCase();
    const matched = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    return matched.map((c) => ({ kind: "command" as const, command: c }));
  }, [query, commands, isAtMode, scope]);

  // Merge all results into a flat list for keyboard navigation
  const allItems: ResultItem[] = useMemo(() => {
    if (isAtMode) return mentionResults;
    if (scope) return [...scopedSessions, ...scopedSources, ...scopeActions];
    return [...sessionResults, ...sourceResults, ...filteredCommands];
  }, [isAtMode, mentionResults, scope, scopedSessions, scopedSources, scopeActions, sessionResults, sourceResults, filteredCommands]);

  // Focus input when opened, reset state
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setSessionResults([]);
      setSourceResults([]);
      setSelectedIndex(0);
      setScope(null);
      setScopedSessions([]);
      setScopedSources([]);
      setScopeActions([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Trigger ensureLoaded when @ is typed
  useEffect(() => {
    if (isAtMode) ensureLoaded();
  }, [isAtMode, ensureLoaded]);

  // ── Scoped mode: fetch sessions + sources for the scoped item ──────────
  useEffect(() => {
    if (!scope || !isOpen) return;

    const searchQuery = query.trim();

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const fetchOpts: Parameters<typeof fetchSessions>[1] = {
          limit: 10,
          ...(searchQuery ? { search: searchQuery } : {}),
        };

        // Also fetch sources for category scopes
        let sourcesPromise: Promise<Source[]> = Promise.resolve([]);

        if (scope.kind === "category") {
          // Category scope: filter by source type across all sources
          fetchOpts.sourceType = scope.type;
          sourcesPromise = fetchSources({ type: scope.type, ...(searchQuery ? { search: searchQuery } : {}) });
        } else {
          // Source/feed/tag scope: filter by specific source ID
          const sourceId = resolveSourceId(scope);
          if (sourceId) fetchOpts.source = sourceId;
        }

        const [{ sessions }, sources] = await Promise.all([
          fetchSessions(userId, fetchOpts),
          sourcesPromise,
        ]);
        setScopedSessions(sessions.map((s) => ({ kind: "session" as const, session: s })));
        setScopedSources(sources.map((s) => ({ kind: "source" as const, source: s })));
      } catch {
        setScopedSessions([]);
        setScopedSources([]);
      } finally {
        setLoading(false);
      }
    }, searchQuery ? 200 : 0);

    return () => clearTimeout(timer);
  }, [scope, query, isOpen, userId]);

  // Build scope actions when scope changes
  // Skip actions for category scopes (too many sources to pick from)
  useEffect(() => {
    if (!scope) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScopeActions([]);
      return;
    }
    if (scope.kind === "category") {
      // No "new session" actions for type-level scope
      setScopeActions([]);
      return;
    }
    const sourceId = resolveSourceId(scope);
    if (!sourceId) return;

    // Get session modes for this source type
    const sourceType = scope.type;
    const config = getSourceTypeConfig(sourceType);
    const modes = config.sessionModes ?? ["custom"];

    const modeLabels: Record<string, string> = {
      reading: "New reading session",
      qa: "New Q&A session",
      news: "New news session",
      custom: "New custom session",
    };

    const actions: ResultItem[] = modes.map((mode) => ({
      kind: "action" as const,
      action: {
        id: `new-${mode}-${sourceId}`,
        label: modeLabels[mode] ?? `New ${mode} session`,
        mode,
        sourceId,
      },
    }));

    setScopeActions(actions);
  }, [scope]);

  // ── Normal mode: fetch sessions + sources ──────────────────────────────
  useEffect(() => {
    if (!isOpen || isAtMode || scope) return;

    const searchQuery = query.trim();

    if (!searchQuery) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      Promise.all([
        fetchSessions(userId, { limit: 5 }),
        fetchSources(),
      ])
        .then(([{ sessions }, sources]) => {
          setSessionResults(sessions.map((s) => ({ kind: "session", session: s })));
          setSourceResults(
            sources.slice(0, 5).map((s) => ({ kind: "source" as const, source: s })),
          );
          setSelectedIndex(0);
        })
        .catch(() => {
          setSessionResults([]);
          setSourceResults([]);
        })
        .finally(() => setLoading(false));
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const [sources, { sessions }] = await Promise.all([
          fetchSources({ search: searchQuery }),
          fetchSessions(userId, { limit: 5, search: searchQuery }),
        ]);

        setSessionResults(sessions.map((s) => ({ kind: "session" as const, session: s })));
        setSourceResults(
          sources.map((s) => ({ kind: "source" as const, source: s })),
        );
        setSelectedIndex(0);
      } catch {
        setSessionResults([]);
        setSourceResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, isOpen, userId, isAtMode, scope]);

  // ── Enter scope ────────────────────────────────────────────────────────
  const enterScope = useCallback((mention: MentionSuggestion) => {
    setScope(mention);
    setQuery("");
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // ── Exit scope ─────────────────────────────────────────────────────────
  const exitScope = useCallback(() => {
    setScope(null);
    setQuery("");
    setScopedSessions([]);
    setScopedSources([]);
    setScopeActions([]);
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const activateItem = useCallback(
    (item: ResultItem) => {
      if (item.kind === "command") {
        item.command.action();
      } else if (item.kind === "mention") {
        enterScope(item.mention);
      } else if (item.kind === "action") {
        onClose();
        navigate(`/source/${item.action.sourceId}?new=${item.action.mode}`);
      } else {
        onClose();
        if (item.kind === "session") {
          navigate(`/source/${item.session.sourceId}?session=${item.session.id}`);
        } else {
          navigate(`/source/${item.source.id}`);
        }
      }
    },
    [navigate, onClose, enterScope],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Backspace on empty input when scoped → exit scope
      if (e.key === "Backspace" && scope && !query) {
        e.preventDefault();
        exitScope();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && allItems[selectedIndex]) {
        e.preventDefault();
        activateItem(allItems[selectedIndex]);
      } else if (e.key === "Tab" && isAtMode && mentionResults[selectedIndex]) {
        // Tab also enters scope in @ mode
        e.preventDefault();
        activateItem(mentionResults[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (scope) {
          exitScope();
        } else {
          onClose();
        }
      }
    },
    [allItems, selectedIndex, activateItem, onClose, scope, query, exitScope, isAtMode, mentionResults],
  );

  // Scroll selected item into view
  useEffect(() => {
    const el = document.querySelector(".spotlight-result.selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Reset selectedIndex when results change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIndex(0);
  }, [allItems.length]);

  if (!isOpen) return null;

  const hasAnyResults = allItems.length > 0;

  /** Render a single result row */
  const renderItem = (item: ResultItem, i: number) => {
    if (item.kind === "mention") {
      return (
        <button
          key={item.mention.id}
          className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
          onClick={() => activateItem(item)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className={`spotlight-result-icon mention-${item.mention.kind}`}>
            <MentionIcon suggestion={item.mention} />
          </div>
          <div className="spotlight-result-text">
            <span className="spotlight-result-title">{item.mention.label}</span>
            {item.mention.sublabel && (
              <span className="spotlight-result-meta">{item.mention.sublabel}</span>
            )}
          </div>
          {item.mention.kind !== "source" && (
            <span className={`spotlight-mention-badge kind-${item.mention.kind}`}>
              {item.mention.kind}
            </span>
          )}
          <CornerDownLeft size={14} className="spotlight-result-arrow" />
        </button>
      );
    }
    if (item.kind === "action") {
      return (
        <button
          key={item.action.id}
          className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
          onClick={() => activateItem(item)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className="spotlight-result-icon action">
            <Plus size={16} />
          </div>
          <div className="spotlight-result-text">
            <span className="spotlight-result-title">{item.action.label}</span>
          </div>
          <ArrowRight size={14} className="spotlight-result-arrow" />
        </button>
      );
    }
    if (item.kind === "session") {
      const config = getSourceTypeConfig(item.session.sourceType ?? 'book');
      return (
        <button
          key={`s-${item.session.id}`}
          className={`spotlight-result ${i === selectedIndex ? "selected" : ""}`}
          onClick={() => activateItem(item)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className="spotlight-result-icon session">
            <MessageSquare size={16} />
          </div>
          <div className="spotlight-result-text">
            <span className="spotlight-result-title">{item.session.title}</span>
            <span className="spotlight-result-meta">
              <span className="spotlight-result-badge">{config.label}</span>
              {!scope && <>{item.session.sourceTitle} · </>}{timeAgo(item.session.lastActiveAt)}
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
          key={`s-${item.source.id}`}
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

  // ── Section labels for scoped mode ─────────────────────────────────────
  const sessionItems = scope ? scopedSessions : sessionResults;
  const actionItems = scope ? scopeActions : [];
  const scopedSourceItems = scope ? scopedSources : [];
  const sourceItems = scope ? [] : sourceResults;

  return (
    <div className="spotlight-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="spotlight-modal">
        <div className="spotlight-input-row">
          <Search size={18} className="spotlight-search-icon" />
          {scope && (
            <button className="spotlight-scope-chip" onClick={exitScope}>
              <MentionIcon suggestion={scope} />
              <span className="spotlight-scope-label">{scope.label}</span>
              <X size={12} />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            className="spotlight-input"
            placeholder={
              scope
                ? "Search sessions…"
                : "Search sources, sessions, and actions… (@ to scope)"
            }
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
            {/* @ mode: mention picker */}
            {isAtMode && mentionResults.length > 0 && (
              <>
                <div className="spotlight-section-label">
                  <Search size={12} /> Scope to…
                </div>
                {mentionResults.map((item, i) => renderItem(item, i))}
              </>
            )}

            {/* Scoped or normal mode */}
            {!isAtMode && (
              <>
                {/* Sessions section */}
                {sessionItems.length > 0 && (
                  <>
                    <div className="spotlight-section-label">
                      <Clock size={12} /> {query.trim() ? "Sessions" : scope ? "Sessions" : "Recent"}
                    </div>
                    {sessionItems.map((item, i) => renderItem(item, i))}
                  </>
                )}

                {/* Sources section (category-scoped mode) */}
                {scopedSourceItems.length > 0 && (
                  <>
                    <div className="spotlight-section-label">
                      <BookOpen size={12} /> Sources
                    </div>
                    {scopedSourceItems.map((item, i) =>
                      renderItem(item, sessionItems.length + i),
                    )}
                  </>
                )}

                {/* Actions section (scoped mode only) */}
                {actionItems.length > 0 && (
                  <>
                    <div className="spotlight-section-label">
                      <Plus size={12} /> New Session
                    </div>
                    {actionItems.map((item, i) =>
                      renderItem(item, sessionItems.length + scopedSourceItems.length + i),
                    )}
                  </>
                )}

                {/* Sources section (normal mode only) */}
                {sourceItems.length > 0 && (
                  <>
                    <div className="spotlight-section-label">
                      <BookOpen size={12} /> Sources
                    </div>
                    {sourceItems.map((item, i) =>
                      renderItem(item, sessionItems.length + scopedSourceItems.length + actionItems.length + i),
                    )}
                  </>
                )}

                {/* Commands section */}
                {filteredCommands.length > 0 && (
                  <>
                    <div className="spotlight-section-label">Actions</div>
                    {filteredCommands.map((item, i) =>
                      renderItem(item, sessionItems.length + scopedSourceItems.length + actionItems.length + sourceItems.length + i),
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {loading && allItems.length === 0 && (
          <div className="spotlight-empty">Searching…</div>
        )}

        {!loading && query.trim() && allItems.length === 0 && !isAtMode && (
          <div className="spotlight-empty">
            No results for "{query}"
          </div>
        )}

        {!loading && isAtMode && mentionResults.length === 0 && (
          <div className="spotlight-empty">
            No sources matching "{atQuery}"
          </div>
        )}

        {!loading && scope && !query.trim() && scopedSessions.length === 0 && (
          <div className="spotlight-empty spotlight-empty-scoped">
            No sessions yet — create one below
          </div>
        )}

        <div className="spotlight-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> {isAtMode ? "scope" : "open"}</span>
          {scope
            ? <span><kbd>⌫</kbd> unscope</span>
            : <span><kbd>@</kbd> scope to source</span>
          }
          <span><kbd>esc</kbd> {scope ? "unscope" : "close"}</span>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the source ID from a mention suggestion.
 *  - source kind → strip "source-" prefix
 *  - feed/tag kind → the news source ID (always "news")
 *  - category kind → null (uses sourceType filter instead)  */
function resolveSourceId(mention: MentionSuggestion): string | null {
  if (mention.kind === "source") {
    return mention.id.replace(/^source-/, "");
  }
  // Feed and tag mentions are scoped to the news source
  if (mention.kind === "feed" || mention.kind === "tag") {
    return "news";
  }
  // Category kind uses sourceType filtering, not a specific source ID
  return null;
}
