import { useState, useRef, useEffect, type ReactNode } from "react";
import type { SourceSession } from "@pi-tree/shared";
import { Pencil, Trash2, Check, X } from "lucide-react";
import "./SessionList.css";

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
// SessionCard
// ---------------------------------------------------------------------------

interface SessionCardProps {
  session: SourceSession;
  icon: ReactNode;
  isDeleting: boolean;
  isEditing: boolean;
  editValue: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onEditValueChange: (val: string) => void;
  onStartDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  isLoading: boolean;
}

function SessionCard({
  session,
  icon,
  isDeleting,
  isEditing,
  editValue,
  editInputRef,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onEditValueChange,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  isLoading,
}: SessionCardProps) {
  return (
    <div className={`session-card ${isDeleting ? "session-card-deleting" : ""}`}>
      {isDeleting ? (
        <div className="session-card-delete-confirm">
          <p>Delete this session? All conversation history will be lost.</p>
          <div className="session-card-delete-actions">
            <button className="session-card-delete-yes" onClick={onConfirmDelete}>
              Delete
            </button>
            <button className="session-card-delete-no" onClick={onCancelDelete}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="session-card-icon">{icon}</div>
          <div className="session-card-body">
            {isEditing ? (
              <div className="session-card-edit-row">
                <input
                  ref={editInputRef}
                  className="session-card-edit-input"
                  value={editValue}
                  onChange={(e) => onEditValueChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCommitRename();
                    if (e.key === "Escape") onCancelRename();
                  }}
                  onBlur={onCommitRename}
                />
                <button className="session-card-edit-btn" onClick={onCommitRename} title="Save">
                  <Check size={14} />
                </button>
                <button
                  className="session-card-edit-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={onCancelRename}
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
              onClick={(e) => { e.stopPropagation(); onStartRename(); }}
              title="Rename session"
            >
              <Pencil size={13} />
            </button>
            <button
              className="session-card-action-btn session-card-action-delete"
              onClick={(e) => { e.stopPropagation(); onStartDelete(); }}
              title="Delete session"
            >
              <Trash2 size={13} />
            </button>
            <button
              className="session-card-resume-btn"
              onClick={onSelect}
              disabled={isLoading}
            >
              Resume
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionList
// ---------------------------------------------------------------------------

interface SessionListProps {
  sessions: SourceSession[];
  /** Render the icon for each session (e.g. mode emoji or Lucide icon) */
  renderIcon: (session: SourceSession) => ReactNode;
  onSelectSession: (session: SourceSession) => void;
  onDeleteSession: (sessionId: number) => void;
  onRenameSession: (sessionId: number, newTitle: string) => void;
  isLoading: boolean;
  className?: string;
}

export function SessionList({
  sessions,
  renderIcon,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  isLoading,
  className,
}: SessionListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Sort sessions: most recently active first
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  );

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

  if (sessions.length === 0) return null;

  return (
    <div className={`session-list ${className || ""}`}>
      {sorted.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          icon={renderIcon(session)}
          isDeleting={deletingId === session.id}
          isEditing={editingId === session.id}
          editValue={editValue}
          editInputRef={editInputRef}
          onSelect={() => onSelectSession(session)}
          onStartRename={() => startRename(session)}
          onCommitRename={commitRename}
          onCancelRename={cancelRename}
          onEditValueChange={setEditValue}
          onStartDelete={() => setDeletingId(session.id)}
          onConfirmDelete={() => confirmDelete(session.id)}
          onCancelDelete={() => setDeletingId(null)}
          isLoading={isLoading}
        />
      ))}
    </div>
  );
}
