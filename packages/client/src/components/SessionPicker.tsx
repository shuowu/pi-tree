import { useState } from "react";
import type { Source, SourceSession } from "@pi-tree/shared";
import type { SessionMode } from "./WelcomeState";
import { BookOpen, MessageCircle, Newspaper, Plus, Search, TrendingUp, Filter, Sparkles } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import { SessionList } from "./SessionList";
import { CustomTriggerModal } from "./CustomTriggerModal";
import "./SessionPicker.css";

// ---------------------------------------------------------------------------
// Mode icon helper
// ---------------------------------------------------------------------------

function modeIcon(mode: string) {
  switch (mode) {
    case "reading":
      return "📖";
    case "qa":
      return "💬";
    case "news":
      return "📡";
    case "custom":
      return "⚙️";
    default:
      return "✨";
  }
}

// ---------------------------------------------------------------------------
// SessionPicker component
// ---------------------------------------------------------------------------

interface SessionPickerProps {
  source: Source;
  sessions: SourceSession[];
  onSelectSession: (session: SourceSession) => void;
  onNewSession: (mode: SessionMode, customTitle?: string, initialQuery?: string, profile?: string) => void;
  onDeleteSession: (sessionId: number) => void;
  onRenameSession: (sessionId: number, newTitle: string) => void;
  isLoading: boolean;
  /** Custom profiles available for this source type (fetched from server) */
  customProfiles?: Array<{ name: string; label: string; description?: string }>;
}

export function SessionPicker({
  source,
  sessions,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  isLoading,
  customProfiles = [],
}: SessionPickerProps) {
  const [showNewSessionOptions, setShowNewSessionOptions] = useState(false);
  const [scanKeyword, setScanKeyword] = useState("");
  const [customTriggers, setCustomTriggers] = useState<Array<{
    id: string;
    title: string;
    type: "overview" | "trends" | "scan";
    keyword?: string;
    feeds: string[];
    tags: string[];
  }>>(() => {
    try {
      const saved = localStorage.getItem("pi-tree-custom-triggers-news");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showCreateTrigger, setShowCreateTrigger] = useState(false);

  const handleSaveCustomTrigger = (newTrigger: typeof customTriggers[0]) => {
    setCustomTriggers((prev) => {
      const next = [...prev, newTrigger];
      localStorage.setItem("pi-tree-custom-triggers-news", JSON.stringify(next));
      return next;
    });
  };

  const handleDeleteCustomTrigger = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomTriggers((prev) => {
      const next = prev.filter((t) => t.id !== id);
      localStorage.setItem("pi-tree-custom-triggers-news", JSON.stringify(next));
      return next;
    });
  };

  // If no sessions exist at all, jump straight to mode selection
  const showOnlyNewSession = sessions.length === 0;

  /** Render mode icon for SessionList */
  const renderModeIcon = (session: SourceSession) => modeIcon(session.context.mode);

  return (
    <div className={`session-picker ${source.type === 'news' ? 'news-layout' : ''}`}>
      <div className="session-picker-content">
        {/* Book header */}
        <div className="session-picker-book-info">
          <h1 className="session-picker-title">{source.title}</h1>
          {source.author && <p className="session-picker-author">by {source.author}</p>}
        </div>

        {source.type === 'news' ? (
          <>
            {/* News Quick Starts (Always Visible) */}
            <p className="session-picker-prompt">Start a news session</p>
            <div className="session-picker-mode-options">
              <button
                className="session-picker-mode-option"
                onClick={() => {
                  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  onNewSession(
                    "news",
                    `News Overview - ${today}`,
                    "Give me a comprehensive overview of today's news and trending topics."
                  );
                }}
                disabled={isLoading}
              >
                <div className="session-picker-mode-icon">
                  <Newspaper size={16} strokeWidth={1.5} />
                </div>
                <div className="session-picker-mode-text">
                  <span className="session-picker-mode-label">News Overview</span>
                  <span className="session-picker-mode-desc">
                    Today's news and trending topics
                  </span>
                </div>
              </button>

              <button
                className="session-picker-mode-option"
                onClick={() => {
                  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  onNewSession(
                    "news",
                    `Trends - ${today}`,
                    "Analyze trends across all feeds from the past 72 hours. What topics are gaining momentum?"
                  );
                }}
                disabled={isLoading}
              >
                <div className="session-picker-mode-icon">
                  <TrendingUp size={16} strokeWidth={1.5} />
                </div>
                <div className="session-picker-mode-text">
                  <span className="session-picker-mode-label">Analyze Trends</span>
                  <span className="session-picker-mode-desc">
                    Topics gaining momentum over 72 hours
                  </span>
                </div>
              </button>

              <div className="session-picker-mode-option scan-option-card">
                <div className="session-picker-mode-icon">
                  <Search size={16} strokeWidth={1.5} />
                </div>
                <div className="session-picker-mode-text">
                  <span className="session-picker-mode-label">Scan Topic</span>
                  <span className="session-picker-mode-desc">
                    Search keywords or topics across feeds
                  </span>
                  <div className="session-picker-scan-input-group" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      placeholder="Enter keyword (e.g. AI, climate)..."
                      value={scanKeyword}
                      onChange={(e) => setScanKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && scanKeyword.trim()) {
                          const kw = scanKeyword.trim();
                          onNewSession("news", `Scan: ${kw}`, `scan ${kw}`);
                          setScanKeyword("");
                        }
                      }}
                    />
                    <button
                      className="session-picker-scan-btn"
                      disabled={isLoading || !scanKeyword.trim()}
                      onClick={() => {
                        const kw = scanKeyword.trim();
                        onNewSession("news", `Scan: ${kw}`, `scan ${kw}`);
                        setScanKeyword("");
                      }}
                    >
                      Go
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Customized Triggers */}
            <div className="custom-triggers-section">
              <div className="custom-triggers-header">
                <p className="session-picker-prompt">Customized Triggers</p>
                <button
                  className="btn-create-trigger-pill"
                  onClick={() => setShowCreateTrigger(true)}
                  disabled={isLoading}
                >
                  <Plus size={12} />
                  New
                </button>
              </div>

              <div className="session-picker-mode-options custom-triggers-grid">
                {customTriggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className="session-picker-mode-option custom-trigger-card"
                    onClick={() => {
                      let query = "";
                      if (trigger.type === "overview") {
                        query = "Give me a comprehensive overview of today's news and trending topics.";
                      } else if (trigger.type === "trends") {
                        query = "Analyze trends across all feeds from the past 72 hours. What topics are gaining momentum?";
                      } else if (trigger.type === "scan") {
                        query = `scan ${trigger.keyword || ""}`;
                      }

                      const filterDescParts: string[] = [];
                      if (trigger.feeds && trigger.feeds.length > 0) {
                        filterDescParts.push(`feeds matching IDs [${trigger.feeds.join(", ")}]`);
                      }
                      if (trigger.tags && trigger.tags.length > 0) {
                        filterDescParts.push(`feeds matching tags [${trigger.tags.join(", ")}]`);
                      }

                      if (filterDescParts.length > 0) {
                        query += ` Please restrict your tool queries to search/aggregate only ${filterDescParts.join(" and ")}.`;
                      }

                      onNewSession("news", trigger.title, query);
                    }}
                  >
                    <button
                      className="custom-trigger-delete-btn"
                      onClick={(e) => handleDeleteCustomTrigger(trigger.id, e)}
                      title="Delete Trigger"
                    >
                      ✕
                    </button>
                    <div className="session-picker-mode-icon">
                      {trigger.type === "overview" ? <Newspaper size={16} strokeWidth={1.5} /> :
                       trigger.type === "trends" ? <TrendingUp size={16} strokeWidth={1.5} /> :
                       <Search size={16} strokeWidth={1.5} />}
                    </div>
                    <div className="session-picker-mode-text">
                      <span className="session-picker-mode-label">{trigger.title}</span>
                      <span className="session-picker-mode-desc">
                        {trigger.type === "scan" ? `Scan: "${trigger.keyword}"` :
                         trigger.type === "trends" ? "Analyze trends" : "News overview"}
                        {(trigger.tags.length > 0 || trigger.feeds.length > 0) && (
                          <span className="custom-trigger-filters-badge">
                            <Filter size={10} />
                            {trigger.tags.length > 0 && trigger.tags.map(t => `#${t}`).join(", ")}
                            {trigger.tags.length > 0 && trigger.feeds.length > 0 && " | "}
                            {trigger.feeds.length > 0 && `${trigger.feeds.length} feeds`}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                ))}

                {customTriggers.length === 0 && (
                  <div
                    className="session-picker-mode-option create-trigger-card-placeholder"
                    onClick={() => setShowCreateTrigger(true)}
                  >
                    <div className="session-picker-mode-icon">
                      <Sparkles size={14} strokeWidth={1.5} />
                    </div>
                    <div className="session-picker-mode-text">
                      <span className="session-picker-mode-label">Create a custom trigger</span>
                      <span className="session-picker-mode-desc">
                        Filter by feeds and tags
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Existing News Sessions */}
            {sessions.length > 0 && (
              <>
                <p className="session-picker-prompt" style={{ marginTop: "var(--space-3)" }}>
                  Recent Sessions
                </p>
                <SessionList
                  sessions={sessions}
                  renderIcon={renderModeIcon}
                  onSelectSession={onSelectSession}
                  onDeleteSession={onDeleteSession}
                  onRenameSession={onRenameSession}
                  isLoading={isLoading}
                  className="session-picker-list"
                />
              </>
            )}
          </>
        ) : (
          /* Book / Other source types */
          showOnlyNewSession ? (
            <>
              {/* No sessions — show creation flow directly */}
              <p className="session-picker-prompt">
                {`How would you like to explore this ${getSourceTypeConfig(source.type).label.toLowerCase()}?`}
              </p>
              <div className="session-picker-mode-options">
                <>
                  <button
                    className="session-picker-mode-option"
                    onClick={() => onNewSession("reading")}
                    disabled={isLoading}
                  >
                    <div className="session-picker-mode-icon">
                      <BookOpen size={24} strokeWidth={1.5} />
                    </div>
                    <div className="session-picker-mode-text">
                      <span className="session-picker-mode-label">Interactive Reading</span>
                      <span className="session-picker-mode-desc">
                        Guided chapter-by-chapter exploration with briefings, discussions, and deep dives
                      </span>
                    </div>
                  </button>

                  <button
                    className="session-picker-mode-option"
                    onClick={() => onNewSession("qa")}
                    disabled={isLoading}
                  >
                    <div className="session-picker-mode-icon">
                      <MessageCircle size={24} strokeWidth={1.5} />
                    </div>
                    <div className="session-picker-mode-text">
                      <span className="session-picker-mode-label">Freeform Q&amp;A</span>
                      <span className="session-picker-mode-desc">
                        Ask anything about the book — themes, arguments, passages, or comparisons
                      </span>
                    </div>
                  </button>

                  {/* Custom profiles */}
                  {customProfiles.map((p) => (
                    <button
                      key={p.name}
                      className="session-picker-mode-option"
                      onClick={() => onNewSession(p.name, p.label, undefined, p.name)}
                      disabled={isLoading}
                    >
                      <div className="session-picker-mode-icon">
                        <Sparkles size={24} strokeWidth={1.5} />
                      </div>
                      <div className="session-picker-mode-text">
                        <span className="session-picker-mode-label">{p.label}</span>
                        <span className="session-picker-mode-desc">
                          {p.description || 'Custom session profile'}
                        </span>
                      </div>
                    </button>
                  ))}
                </>
              </div>
            </>
          ) : (
            <>
              {/* Existing sessions list */}
              <p className="session-picker-prompt">Your Reading Sessions</p>

              <SessionList
                sessions={sessions}
                renderIcon={renderModeIcon}
                onSelectSession={onSelectSession}
                onDeleteSession={onDeleteSession}
                onRenameSession={onRenameSession}
                isLoading={isLoading}
                className="session-picker-list"
              />

              {/* New session button / mode picker */}
              {showNewSessionOptions ? (
                <div className="session-picker-new-expanded">
                  <p className="session-picker-new-label">Choose a mode:</p>
                  <div className="session-picker-mode-options compact">
                    <>
                      <button
                        className="session-picker-mode-option"
                        onClick={() => { setShowNewSessionOptions(false); onNewSession("reading"); }}
                        disabled={isLoading}
                      >
                        <div className="session-picker-mode-icon">
                          <BookOpen size={20} strokeWidth={1.5} />
                        </div>
                        <div className="session-picker-mode-text">
                          <span className="session-picker-mode-label">Interactive Reading</span>
                          <span className="session-picker-mode-desc">
                            Guided chapter-by-chapter exploration
                          </span>
                        </div>
                      </button>
                      <button
                        className="session-picker-mode-option"
                        onClick={() => { setShowNewSessionOptions(false); onNewSession("qa"); }}
                        disabled={isLoading}
                      >
                        <div className="session-picker-mode-icon">
                          <MessageCircle size={20} strokeWidth={1.5} />
                        </div>
                        <div className="session-picker-mode-text">
                          <span className="session-picker-mode-label">Freeform Q&amp;A</span>
                          <span className="session-picker-mode-desc">
                            Ask anything about the book
                          </span>
                        </div>
                      </button>

                      {/* Custom profiles */}
                      {customProfiles.map((p) => (
                        <button
                          key={p.name}
                          className="session-picker-mode-option"
                          onClick={() => { setShowNewSessionOptions(false); onNewSession(p.name, p.label, undefined, p.name); }}
                          disabled={isLoading}
                        >
                          <div className="session-picker-mode-icon">
                            <Sparkles size={20} strokeWidth={1.5} />
                          </div>
                          <div className="session-picker-mode-text">
                            <span className="session-picker-mode-label">{p.label}</span>
                            <span className="session-picker-mode-desc">
                              {p.description || 'Custom session profile'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </>
                  </div>
                  <button
                    className="session-picker-cancel-btn"
                    onClick={() => setShowNewSessionOptions(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="session-picker-new-btn"
                  onClick={() => {
                    setShowNewSessionOptions(true);
                  }}
                  disabled={isLoading}
                >
                  <Plus size={16} />
                  Start New Session
                </button>
              )}
            </>
          )
        )}
      {showCreateTrigger && (
        <CustomTriggerModal
          onClose={() => setShowCreateTrigger(false)}
          onSave={handleSaveCustomTrigger}
        />
      )}
      </div>
    </div>
  );
}
