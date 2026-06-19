import type { Source } from "@pi-tree/shared";
import { MessageCircle } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import "./SourceSetupState.css";

interface SourceSetupStateProps {
  source: Source;
  job?: unknown;
  onSkipToChat: () => void;
  onProcess?: () => void;
}

export function SourceSetupState({ source, onSkipToChat }: SourceSetupStateProps) {
  const config = getSourceTypeConfig(source.type);
  return (
    <div className="setup-state">
      <div className="setup-content">
        <div className="setup-source-info">
          <h1 className="setup-title">{source.title}</h1>
          <p className="setup-author">by {source.author}</p>
        </div>

        <div className="setup-options">
          <button
            className="setup-option"
            onClick={onSkipToChat}
          >
            <div className="setup-option-icon">
              <MessageCircle size={24} strokeWidth={1.5} />
            </div>
            <div className="setup-option-text">
              <span className="setup-option-label">Start Reading Session</span>
              <span className="setup-option-desc">
                {source.status === "pending"
                  ? `Start a conversation to process and explore this ${config.label.toLowerCase()}.`
                  : `Start a conversation about this ${config.label.toLowerCase()}`}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
