import { useState, useMemo, useRef } from "react";
import type { Source, SourceSession } from "@pi-tree/shared";
import type { ProfileInfo } from "../api";
import { Plus, Search, Upload } from "lucide-react";
import { Sparkles } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import { resolveIcon } from "../utils/resolve-icon";
import { SessionList } from "./SessionList";
import "./SessionPicker.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// SessionPicker component
// ---------------------------------------------------------------------------

export type SessionMode = string;

interface SessionPickerProps {
  source: Source;
  sessions: SourceSession[];
  profiles: Record<string, ProfileInfo>;
  onSelectSession: (session: SourceSession) => void;
  onNewSession: (mode: SessionMode, customTitle?: string, initialQuery?: string, profile?: string) => void;
  onDeleteSession: (sessionId: number) => void;
  onRenameSession: (sessionId: number, newTitle: string) => void;
  onExportSession?: (sessionId: number, format: "html" | "jsonl") => void;
  /** Import a .pi-tree.jsonl bundle file */
  onImportFile?: (file: File) => void;
  isLoading: boolean;
}

export function SessionPicker({
  source,
  sessions,
  profiles,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onExportSession,
  onImportFile,
  isLoading,
}: SessionPickerProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [showProfilePicker, setShowProfilePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // -------------------------------------------------------------------------
  // Filter profiles matching this source type
  // -------------------------------------------------------------------------

  const matchingProfiles: Array<[string, ProfileInfo]> = useMemo(() => {
    const result: Array<[string, ProfileInfo]> = [];

    for (const [key, profile] of Object.entries(profiles)) {
      const matchesType =
        (profile.sourceType && profile.sourceType === source.type) ||
        (!profile.sourceType && key.startsWith(`${source.type}.`));

      if (matchesType) {
        result.push([key, profile]);
      }
    }

    // Also include custom profiles (no sourceType, no dot = source-agnostic)
    for (const [key, profile] of Object.entries(profiles)) {
      if (!profile.sourceType && !key.includes(".")) {
        result.push([key, profile]);
      }
    }

    return result.sort((a, b) => (a[1].order ?? 100) - (b[1].order ?? 100));
  }, [profiles, source.type]);

  // -------------------------------------------------------------------------
  // Derive available mode filter chips from sessions
  // -------------------------------------------------------------------------

  const modeChips = useMemo(() => {
    const modeCounts = new Map<string, number>();
    for (const s of sessions) {
      const mode = s.context.mode ?? "reading";
      modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
    }
    // Only show chips if there are 2+ distinct modes
    if (modeCounts.size < 2) return [];
    return Array.from(modeCounts.entries())
      .sort((a, b) => b[1] - a[1]) // most used first
      .map(([mode, count]) => {
        const profileKey = `${source.type}.${mode}`;
        const profile = profiles[profileKey] || profiles[mode];
        return { mode, label: profile?.label ?? mode, count };
      });
  }, [sessions, profiles, source.type]);

  // -------------------------------------------------------------------------
  // Filter and paginate sessions
  // -------------------------------------------------------------------------

  const filteredSessions = useMemo(() => {
    let result = sessions;

    // Filter by mode
    if (modeFilter) {
      result = result.filter(s => (s.context.mode ?? "reading") === modeFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s => s.title.toLowerCase().includes(q));
    }

    return result;
  }, [sessions, modeFilter, searchQuery]);

  const visibleSessions = filteredSessions.slice(0, visibleCount);
  const hasMore = visibleCount < filteredSessions.length;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const modeFromKey = (key: string) => {
    const dot = key.indexOf(".");
    return dot >= 0 ? key.slice(dot + 1) : key;
  };

  const handleNewSession = (profileKey: string) => {
    const mode = modeFromKey(profileKey);
    onNewSession(mode, undefined, undefined, profileKey);
    setShowProfilePicker(false);
  };

  const handleNewSessionClick = () => {
    if (matchingProfiles.length === 1) {
      handleNewSession(matchingProfiles[0][0]);
    } else {
      setShowProfilePicker(true);
    }
  };

  const importControl = onImportFile ? (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".jsonl,application/jsonl,application/x-jsonlines"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportFile(file);
          e.target.value = ""; // allow re-importing the same file
        }}
      />
      <button
        className="session-picker-import-btn"
        onClick={() => importInputRef.current?.click()}
        disabled={isLoading}
        title="Import a session exported as .jsonl"
      >
        <Upload size={13} />
        Import
      </button>
    </>
  ) : null;

  const renderModeIcon = (session: SourceSession) => {
    const mode = session.context.mode;
    const profileKey = `${source.type}.${mode}`;
    const profile = profiles[profileKey] || profiles[mode];
    if (profile?.icon) {
      const Icon = resolveIcon(profile.icon, Sparkles);
      return <Icon size={14} strokeWidth={1.5} />;
    }
    return "✨";
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // No sessions — show profile picker directly
  if (sessions.length === 0) {
    return (
      <div className="session-picker">
        <div className="session-picker-content">
          <div className="session-picker-source-info">
            <h1 className="session-picker-title">{source.title}</h1>
            {source.author && <p className="session-picker-author">by {source.author}</p>}
          </div>

          {matchingProfiles.length === 1 ? (
            <>
              <p className="session-picker-prompt">
                {`Start exploring this ${getSourceTypeConfig(source.type).label.toLowerCase()}`}
              </p>
              <button
                className="session-picker-new-btn"
                onClick={() => handleNewSession(matchingProfiles[0][0])}
                disabled={isLoading}
              >
                <Plus size={16} />
                Start Session
              </button>
              {importControl}
            </>
          ) : (
            <>
              <p className="session-picker-prompt">
                {`How would you like to explore this ${getSourceTypeConfig(source.type).label.toLowerCase()}?`}
              </p>
              <div className="session-picker-mode-options">
                {matchingProfiles.map(([key, profile]) => {
                  const Icon = resolveIcon(profile.icon, Sparkles);
                  return (
                    <button
                      key={key}
                      className="session-picker-mode-option"
                      onClick={() => handleNewSession(key)}
                      disabled={isLoading}
                    >
                      <div className="session-picker-mode-icon">
                        <Icon size={24} strokeWidth={1.5} />
                      </div>
                      <div className="session-picker-mode-text">
                        <span className="session-picker-mode-label">{profile.label}</span>
                        {profile.description && (
                          <span className="session-picker-mode-desc">{profile.description}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Has sessions — show new session + history
  return (
    <div className="session-picker">
      <div className="session-picker-content">
        {/* Source header */}
        <div className="session-picker-source-info">
          <h1 className="session-picker-title">{source.title}</h1>
          {source.author && <p className="session-picker-author">by {source.author}</p>}
        </div>

        {/* New session — at the top */}
        {showProfilePicker ? (
          <div className="session-picker-new-expanded">
            <p className="session-picker-new-label">Choose a mode:</p>
            <div className="session-picker-mode-options compact">
              {matchingProfiles.map(([key, profile]) => {
                const Icon = resolveIcon(profile.icon, Sparkles);
                return (
                  <button
                    key={key}
                    className="session-picker-mode-option"
                    onClick={() => handleNewSession(key)}
                    disabled={isLoading}
                  >
                    <div className="session-picker-mode-icon">
                      <Icon size={20} strokeWidth={1.5} />
                    </div>
                    <div className="session-picker-mode-text">
                      <span className="session-picker-mode-label">{profile.label}</span>
                      {profile.description && (
                        <span className="session-picker-mode-desc">{profile.description}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              className="session-picker-cancel-btn"
              onClick={() => setShowProfilePicker(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="session-picker-new-btn"
            onClick={handleNewSessionClick}
            disabled={isLoading}
          >
            <Plus size={16} />
            New Session
          </button>
        )}

        {/* Session history header */}
        <div className="session-picker-history-header">
          <p className="session-picker-prompt">
            {filteredSessions.length === sessions.length
              ? `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
              : `${filteredSessions.length} of ${sessions.length} sessions`}
          </p>
          {importControl}
        </div>

        {/* Search + mode filter toolbar */}
        {sessions.length > 3 && (
          <div className="session-picker-toolbar">
            <div className="session-picker-search">
              <Search size={14} className="session-picker-search-icon" />
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setVisibleCount(PAGE_SIZE); // reset pagination on search
                }}
                className="session-picker-search-input"
              />
            </div>

            {modeChips.length > 0 && (
              <div className="session-picker-mode-chips">
                <button
                  className={`session-picker-chip ${modeFilter === null ? "active" : ""}`}
                  onClick={() => { setModeFilter(null); setVisibleCount(PAGE_SIZE); }}
                >
                  All
                </button>
                {modeChips.map(({ mode, label, count }) => (
                  <button
                    key={mode}
                    className={`session-picker-chip ${modeFilter === mode ? "active" : ""}`}
                    onClick={() => { setModeFilter(modeFilter === mode ? null : mode); setVisibleCount(PAGE_SIZE); }}
                  >
                    {label} <span className="session-picker-chip-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Session list */}
        {filteredSessions.length > 0 ? (
          <>
            <SessionList
              sessions={visibleSessions}
              renderIcon={renderModeIcon}
              onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession}
              onRenameSession={onRenameSession}
              onExportSession={onExportSession}
              isLoading={isLoading}
              className="session-picker-list"
            />

            {hasMore && (
              <button
                className="session-picker-load-more"
                onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
              >
                Show more ({filteredSessions.length - visibleCount} remaining)
              </button>
            )}
          </>
        ) : (
          <p className="session-picker-empty">No sessions match your search.</p>
        )}
      </div>
    </div>
  );
}
