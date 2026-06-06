import { Cpu, RotateCcw, X } from "lucide-react";
import type { Book } from "@pi-books/shared";
import "./BookSettingsModal.css";

interface BookSettingsModalProps {
  book: Book;
  onClose: () => void;
  onReprocess: () => void;
  onClearSession: () => void;
  /** Label of the currently active session, if any */
  sessionLabel?: string | null;
}

export function BookSettingsModal({ book, onClose, onReprocess, onClearSession, sessionLabel }: BookSettingsModalProps) {
  return (
    <div className="book-settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="book-settings-modal">
        <header className="book-settings-header">
          <h2>Book Settings &amp; Actions</h2>
          <button className="book-settings-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </button>
        </header>

        <div className="book-settings-body">
          <div className="book-settings-info">
            <div className="book-settings-title">{book.title}</div>
            <div className="book-settings-author">by {book.author}</div>
          </div>

          <hr className="book-settings-divider" />

          <div className="book-settings-section">
            <div className="book-settings-section-info">
              <h3>Reprocess Book</h3>
              <p>
                Regenerate the navigation outline, table of contents, and summaries using the AI. 
                Use this if chapters are missing or if you want to apply new global settings.
              </p>
            </div>
            <button className="book-settings-action-btn reprocess-btn" onClick={() => { onReprocess(); onClose(); }}>
              <Cpu size={14} /> Reprocess Book
            </button>
          </div>

          <div className="book-settings-section">
            <div className="book-settings-section-info">
              <h3>Clear Current Session</h3>
              <p>
                {sessionLabel
                  ? <>Reset the <strong>{sessionLabel}</strong> session — erases all chat history and conversation tree for this session. This action is irreversible.</>
                  : <>Reset your current reading session and erase all chat history/conversation tree. This action is irreversible.</>
                }
              </p>
              <p className="book-settings-hint">
                To manage all sessions (rename, delete, or create new ones), use the session picker from the breadcrumb bar.
              </p>
            </div>
            <button className="book-settings-action-btn clear-session-btn" onClick={() => { onClearSession(); onClose(); }}>
              <RotateCcw size={14} /> Clear Chat History
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
