import { useState, useRef, useEffect } from "react";
import type { Source, SourceSession } from "@pi-tree/shared";
import type { SessionMode } from "./WelcomeState";
import { BookOpen, MessageCircle, Newspaper, Plus, Trash2, Pencil, Check, X, Search, TrendingUp, Filter, Sparkles } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import { CustomTriggerModal } from "./CustomTriggerModal";
import "./SessionPicker.css";

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

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
      return "📖";
  }
}

// ---------------------------------------------------------------------------
// SessionPicker component
// ---------------------------------------------------------------------------

interface SessionPickerProps {
  source: Source;
  sessions: SourceSession[];
  onSelectSession: (session: SourceSession) => void;
  onNewSession: (mode: SessionMode, customTitle?: string, initialQuery?: string) => void;
  onDeleteSession: (sessionId: number) => void;
  onRenameSession: (sessionId: number, newTitle: string) => void;
  isLoading: boolean;
}

export function SessionPicker({
  source,
  sessions,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  isLoading,
}: SessionPickerProps) {
  const [showNewSessionOptions, setShowNewSessionOptions] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
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

  const editInputRef = useRef<HTMLInputElement>(null);

  // Sort sessions: most recently active first
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  );

  // If no sessions exist at all, jump straight to mode selection
  const showOnlyNewSession = sessions.length === 0;

  useEffect(() => {
    if (editingId !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startRename = (session: SourceSession) => {
    setEditingId(session.id);
    setEditValue(session.title);
  };

  const commitRename = () => {
    if (editingId !== null && editValue.trim()) {
      onRenameSession(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditValue("");
  };

  const confirmDelete = (sessionId: number) => {
    onDeleteSession(sessionId);
    setDeletingId(null);
  };

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
                <div className="session-picker-list">
                  {sorted.map((session) => (
                    <div
                      key={session.id}
                      className={`session-card ${deletingId === session.id ? "session-card-deleting" : ""}`}
                    >
                      {deletingId === session.id ? (
                        <div className="session-card-delete-confirm">
                          <p>Delete this session? All conversation history will be lost.</p>
                          <div className="session-card-delete-actions">
                            <button
                              className="session-card-delete-yes"
                              onClick={() => confirmDelete(session.id)}
                            >
                              Delete
                            </button>
                            <button
                              className="session-card-delete-no"
                              onClick={() => setDeletingId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="session-card-icon">
                            {modeIcon(session.context.mode)}
                          </div>
                          <div className="session-card-body">
                            {editingId === session.id ? (
                              <div className="session-card-edit-row">
                                <input
                                  ref={editInputRef}
                                  className="session-card-edit-input"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitRename();
                                    if (e.key === "Escape") cancelRename();
                                  }}
                                  onBlur={commitRename}
                                />
                                <button
                                  className="session-card-edit-btn"
                                  onClick={commitRename}
                                  title="Save"
                                >
                                  <Check size={14} />
                                </button>
                                <button
                                  className="session-card-edit-btn"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={cancelRename}
                                  title="Cancel"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <span className="session-card-title">{session.title}</span>
                            )}
                            <span className="session-card-meta">
                              Started {formatDate(session.createdAt)} · Last active{" "}
                              {relativeTime(session.lastActiveAt)}
                            </span>
                          </div>
                          <div className="session-card-actions">
                            <button
                              className="session-card-action-btn"
                              onClick={(e) => { e.stopPropagation(); startRename(session); }}
                              title="Rename session"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              className="session-card-action-btn session-card-action-delete"
                              onClick={(e) => { e.stopPropagation(); setDeletingId(session.id); }}
                              title="Delete session"
                            >
                              <Trash2 size={13} />
                            </button>
                            <button
                              className="session-card-resume-btn"
                              onClick={() => onSelectSession(session)}
                              disabled={isLoading}
                            >
                              Resume
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
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
                </>
              </div>
            </>
          ) : (
            <>
              {/* Existing sessions list */}
              <p className="session-picker-prompt">Your Reading Sessions</p>

              <div className="session-picker-list">
                {sorted.map((session) => (
                  <div
                    key={session.id}
                    className={`session-card ${deletingId === session.id ? "session-card-deleting" : ""}`}
                  >
                    {deletingId === session.id ? (
                      <div className="session-card-delete-confirm">
                        <p>Delete this session? All conversation history will be lost.</p>
                        <div className="session-card-delete-actions">
                          <button
                            className="session-card-delete-yes"
                            onClick={() => confirmDelete(session.id)}
                          >
                            Delete
                          </button>
                          <button
                            className="session-card-delete-no"
                            onClick={() => setDeletingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="session-card-icon">
                          {modeIcon(session.context.mode)}
                        </div>
                        <div className="session-card-body">
                          {editingId === session.id ? (
                            <div className="session-card-edit-row">
                              <input
                                ref={editInputRef}
                                className="session-card-edit-input"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitRename();
                                  if (e.key === "Escape") cancelRename();
                                }}
                                onBlur={commitRename}
                              />
                              <button
                                className="session-card-edit-btn"
                                onClick={commitRename}
                                title="Save"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                className="session-card-edit-btn"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={cancelRename}
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <span className="session-card-title">{session.title}</span>
                          )}
                          <span className="session-card-meta">
                            Started {formatDate(session.createdAt)} · Last active{" "}
                            {relativeTime(session.lastActiveAt)}
                          </span>
                        </div>
                        <div className="session-card-actions">
                          <button
                            className="session-card-action-btn"
                            onClick={(e) => { e.stopPropagation(); startRename(session); }}
                            title="Rename session"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="session-card-action-btn session-card-action-delete"
                            onClick={(e) => { e.stopPropagation(); setDeletingId(session.id); }}
                            title="Delete session"
                          >
                            <Trash2 size={13} />
                          </button>
                          <button
                            className="session-card-resume-btn"
                            onClick={() => onSelectSession(session)}
                            disabled={isLoading}
                          >
                            Resume
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

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
