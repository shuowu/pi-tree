import type { Book } from "@pi-books/shared";
import { Cpu, MessageCircle } from "lucide-react";
import "./BookSetupState.css";

interface BookSetupStateProps {
  book: Book;
  onSkipToChat: () => void;
  onProcess: () => void;
}

export function BookSetupState({ book, onSkipToChat, onProcess }: BookSetupStateProps) {
  return (
    <div className="setup-state">
      <div className="setup-content">
        <div className="setup-book-info">
          <h1 className="setup-title">{book.title}</h1>
          <p className="setup-author">by {book.author}</p>
        </div>

        <div className="setup-options">
          <button
            className="setup-option"
            onClick={onProcess}
            disabled
          >
            <div className="setup-option-icon">
              <Cpu size={24} strokeWidth={1.5} />
            </div>
            <div className="setup-option-text">
              <span className="setup-option-label">Process Book</span>
              <span className="setup-option-desc">
                Processing generates an outline and table of contents to enable interactive reading. This takes 2–5 minutes.
              </span>
              <span className="setup-option-note">
                Coming soon — processing will be available in a future update
              </span>
            </div>
          </button>

          <div className="setup-divider">or</div>

          <button
            className="setup-option"
            onClick={onSkipToChat}
          >
            <div className="setup-option-icon">
              <MessageCircle size={24} strokeWidth={1.5} />
            </div>
            <div className="setup-option-text">
              <span className="setup-option-label">Start Freeform Q&amp;A</span>
              <span className="setup-option-desc">
                Ask anything about the book without processing
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
