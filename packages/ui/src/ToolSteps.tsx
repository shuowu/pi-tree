import { useState } from "react";
import type { ToolStep } from "@pi-tree/core/types";
import "./styles/ToolSteps.css";

/** Past-tense human-readable label for a completed (or running) tool step */
function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  const path = (args.path ?? args.file ?? args.pattern ?? args.query ?? "") as string;
  const shortPath = path ? path.split("/").slice(-2).join("/") : "";

  switch (toolName) {
    case "read":
      return shortPath ? `Read ${shortPath}` : "Read book content";
    case "grep":
      return shortPath ? `Searched for "${shortPath}"` : "Searched content";
    case "find":
    case "ls":
      return shortPath ? `Browsed ${shortPath}` : "Browsed files";
    default: {
      // For dynamic tool names like mcp_brave_search, make them readable
      const readable = toolName.replace(/_/g, " ").replace(/\bmcp\b/i, "").trim();
      return readable ? `Ran ${readable}` : `Ran ${toolName}`;
    }
  }
}

export function ToolSteps({ steps, isStreaming }: { steps: ToolStep[]; isStreaming?: boolean }) {
  const [userToggled, setUserToggled] = useState(false);
  // Auto-expand during streaming, collapse on completed messages.
  // Once the user manually toggles, respect their choice.
  const expanded = userToggled ? !isStreaming : !!isStreaming;
  if (steps.length === 0) return null;

  return (
    <div className="pit-tool-steps">
      <button
        className="pit-tool-steps-toggle"
        onClick={() => setUserToggled(!userToggled)}
      >
        <span className={`pit-tool-steps-chevron ${expanded ? "pit-expanded" : ""}`}>›</span>
        <span className="pit-tool-steps-count">
          {steps.length} step{steps.length !== 1 ? "s" : ""}
          {isStreaming && <span className="pit-tool-steps-streaming"> · running</span>}
        </span>
      </button>
      {expanded && (
        <div className="pit-tool-steps-list">
          {steps.map((step, i) => (
            <div key={i} className="pit-tool-step-item">
              <span className={`pit-tool-step-status pit-tool-step-${step.status}`}>
                {step.status === "running" ? (
                  <span className="pit-tool-call-spinner" />
                ) : step.status === "error" ? "✗" : "✓"}
              </span>
              <span className="pit-tool-step-label">
                {describeToolCall(step.toolName, step.args)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
