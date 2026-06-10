import type { Source } from "@pi-tree/shared";
import type { Job } from "../api";
import { Cpu, MessageCircle } from "lucide-react";
import "./BookSetupState.css";

interface BookSetupStateProps {
  source: Source;
  job: Job | null;
  onSkipToChat: () => void;
  onProcess: () => void;
}

export function BookSetupState({ source, job, onSkipToChat, onProcess }: BookSetupStateProps) {
  const isProcessing = source.status === "processing";

  const getStepLabel = (step?: string) => {
    switch (step) {
      case "queued": return "Queued in line";
      case "parsing_file": return "Parsing ebook files";
      case "writing_markdown": return "Saving formatted markdown";
      case "generating_outline": return "AI Analysis: Creating outline & TOC";
      case "generating_summary": return "AI Analysis: Writing summaries";
      case "finished": return "Finalizing book contents";
      default: return "Processing book";
    }
  };

  const progress = job?.progress ?? (isProcessing ? 5 : 0);
  const stepLabel = getStepLabel(job?.step);

  return (
    <div className="setup-state">
      <div className="setup-content">
        <div className="setup-book-info">
          <h1 className="setup-title">{source.title}</h1>
          <p className="setup-author">by {source.author}</p>
        </div>

        <div className="setup-options">
          {isProcessing ? (
            <div className="setup-option processing-card">
              <div className="setup-option-icon animate-pulse">
                <Cpu size={24} strokeWidth={1.5} />
              </div>
              <div className="setup-option-text" style={{ width: "100%" }}>
                <div className="processing-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span className="setup-option-label" style={{ fontWeight: 600 }}>{stepLabel}</span>
                  <span className="processing-percentage" style={{ fontWeight: 600, fontSize: "14px" }}>{progress}%</span>
                </div>
                <div className="progress-bar-container" style={{ width: "100%", height: "6px", backgroundColor: "rgba(0, 0, 0, 0.08)", borderRadius: "3px", overflow: "hidden", marginBottom: "8px" }}>
                  <div className="progress-bar-fill" style={{ width: `${progress}%`, height: "100%", backgroundColor: "var(--primary, #3b82f6)", borderRadius: "3px", transition: "width 0.4s ease" }} />
                </div>
                <span className="setup-option-desc">
                  We are generating a navigation outline, table of contents, and a high-level summary. This runs in the background; you can safely close this tab or navigate away.
                </span>
              </div>
            </div>
          ) : (
            <button
              className="setup-option"
              onClick={onProcess}
            >
              <div className="setup-option-icon">
                <Cpu size={24} strokeWidth={1.5} />
              </div>
              <div className="setup-option-text">
                <span className="setup-option-label">Process Book</span>
                <span className="setup-option-desc">
                  Processing generates an outline and table of contents to enable interactive reading. This takes 30–60 seconds.
                </span>
                <span className="setup-option-note">
                  Now available! Click to begin processing.
                </span>
              </div>
            </button>
          )}

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
