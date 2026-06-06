import { useState, useRef, useEffect } from "react";
import type { Book, BookSession } from "@pi-books/shared";
import type { SessionMode } from "./WelcomeState";
import { BookOpen, MessageCircle, Plus, Trash2, Pencil, Check, X } from "lucide-react";
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
  book: Book;
  sessions: BookSession[];
  onSelectSession: (session: BookSession) => void;
  onNewSession: (mode: SessionMode) => void;
  onDeleteSession: (sessionId: number) => void;
  onRenameSession: (sessionId: number, newTitle: string) => void;
  isLoading: boolean;
}

export function SessionPicker({
  book,
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

  const startRename = (session: BookSession) => {
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
    <div className="session-picker">
      <div className="session-picker-content">
        {/* Book header */}
        <div className="session-picker-book-info">
          <h1 className="session-picker-title">{book.title}</h1>
          <p className="session-picker-author">by {book.author}</p>
        </div>

        {showOnlyNewSession ? (
          <>
            {/* No sessions — show creation flow directly */}
            <p className="session-picker-prompt">How would you like to explore this book?</p>
            <div className="session-picker-mode-options">
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
                onClick={() => setShowNewSessionOptions(true)}
                disabled={isLoading}
              >
                <Plus size={16} />
                Start New Session
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
