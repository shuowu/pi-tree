import { useEffect } from "react";
import type { Source } from "@pi-tree/shared";
import { BookOpen, MessageCircle } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import "./WelcomeState.css";

export type SessionMode = string;

interface WelcomeStateProps {
  source: Source;
  onSelectMode: (mode: SessionMode) => void;
  isLoading: boolean;
}

export function WelcomeState({ source, onSelectMode, isLoading }: WelcomeStateProps) {
  const config = getSourceTypeConfig(source.type);

  useEffect(() => {
    if (config.autoStartMode && !isLoading) {
      onSelectMode(config.autoStartMode as SessionMode);
    }
  }, [config.autoStartMode, isLoading, onSelectMode]);

  if (source.type === "news") {
    return (
      <div className="welcome-state">
        <div className="welcome-content">
          <div className="welcome-book-info">
            <h1 className="welcome-title">News &amp; Trends</h1>
            <p className="welcome-author">RSS Aggregator</p>
          </div>
          <p className="welcome-prompt">Initializing news feeds scanner...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome-state">
      <div className="welcome-content">
        <div className="welcome-book-info">
          <h1 className="welcome-title">{source.title}</h1>
          <p className="welcome-author">by {source.author}</p>
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
