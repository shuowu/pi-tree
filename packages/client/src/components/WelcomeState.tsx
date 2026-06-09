import type { Book } from "@pi-tree/shared";
import { BookOpen, MessageCircle } from "lucide-react";
import "./WelcomeState.css";

export type SessionMode = "reading" | "qa";

interface WelcomeStateProps {
  book: Book;
  onSelectMode: (mode: SessionMode) => void;
  isLoading: boolean;
}

export function WelcomeState({ book, onSelectMode, isLoading }: WelcomeStateProps) {
  return (
    <div className="welcome-state">
      <div className="welcome-content">
        <div className="welcome-book-info">
          <h1 className="welcome-title">{book.title}</h1>
          <p className="welcome-author">by {book.author}</p>
        </div>

        <p className="welcome-prompt">How would you like to explore this book?</p>

        <div className="welcome-options">
          <button
            className="welcome-option"
            onClick={() => onSelectMode("reading")}
            disabled={isLoading}
          >
            <div className="welcome-option-icon">
              <BookOpen size={24} strokeWidth={1.5} />
            </div>
            <div className="welcome-option-text">
              <span className="welcome-option-label">Interactive Reading</span>
              <span className="welcome-option-desc">
                Guided chapter-by-chapter exploration with briefings, discussions, and deep dives
              </span>
            </div>
          </button>

          <button
            className="welcome-option"
            onClick={() => onSelectMode("qa")}
            disabled={isLoading}
          >
            <div className="welcome-option-icon">
              <MessageCircle size={24} strokeWidth={1.5} />
            </div>
            <div className="welcome-option-text">
              <span className="welcome-option-label">Freeform Q&amp;A</span>
              <span className="welcome-option-desc">
                Ask anything about the book — themes, arguments, passages, or comparisons
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
