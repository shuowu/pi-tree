import type { Source } from "@pi-tree/shared";
import { MessageCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { getSourceTypeConfig } from "../source-types";
import type { Job } from "../api";
import "./SourceSetupState.css";

interface SourceSetupStateProps {
  source: Source;
  /** undefined = job status not fetched yet; null = no job exists for this source */
  job?: Job | null;
  onSkipToChat: () => void;
  onProcess?: () => void;
}

function getStepLabel(step?: string): string {
  switch (step) {
    case "queued": return "Queued for processing";
    case "converting": return "Converting to markdown";
    case "analyzing": return "AI analyzing: outline & summary";
    case "extracting concepts": return "Extracting concepts";
    default: return "Processing";
  }
}

export function SourceSetupState({ source, job, onSkipToChat, onProcess }: SourceSetupStateProps) {
  const config = getSourceTypeConfig(source.type);

  const jobActive = job != null && (job.status === "pending" || job.status === "processing");
  // job === null means no job exists (e.g. server restarted mid-processing) —
  // fall through to the session button as an escape hatch
  const isProcessing = jobActive || (source.status === "processing" && job === undefined);
  const failed = !jobActive && (source.status === "failed" || job?.status === "failed");

  return (
    <div className="setup-state">
      <div className="setup-content">
        <div className="setup-source-info">
          <h1 className="setup-title">{source.title}</h1>
          <p className="setup-author">by {source.author}</p>
        </div>

        {isProcessing ? (
          <div className="setup-processing">
            <div className="setup-processing-header">
              <Loader2 size={18} className="setup-spinner" />
              <span>{getStepLabel(job?.step)}…</span>
            </div>
            <div className="setup-progress-bar">
              <div
                className="setup-progress-fill"
                style={{ width: `${job?.progress ?? 5}%` }}
              />
            </div>
            <p className="setup-processing-note">
              You can start reading and chatting as soon as processing finishes.
              Feel free to leave this page — processing continues in the background.
            </p>
          </div>
        ) : failed ? (
          <div className="setup-failed">
            <div className="setup-failed-header">
              <AlertCircle size={18} />
              <span>Processing failed</span>
            </div>
            <p className="setup-failed-error">
              {job?.error ?? "The file could not be processed — it may be corrupt or in an unsupported format. Try re-uploading it, or retry below."}
            </p>
            {onProcess && (
              <button className="setup-retry-btn" onClick={onProcess}>
                <RefreshCw size={14} />
                Retry processing
              </button>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
