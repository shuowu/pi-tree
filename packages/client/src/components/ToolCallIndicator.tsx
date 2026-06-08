/** Produce a human-readable label for a tool call */
function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  const path = (args.path ?? args.file ?? args.pattern ?? args.query ?? "") as string;
  const shortPath = path ? path.split("/").slice(-2).join("/") : "";

  switch (toolName) {
    case "read":
      return shortPath ? `Reading ${shortPath}` : "Reading book content";
    case "grep":
      return shortPath ? `Searching for \"${shortPath}\"` : "Searching content";
    case "find":
    case "ls":
      return shortPath ? `Browsing ${shortPath}` : "Browsing files";
    default:
      return `Running ${toolName}`;
  }
}

/** Compact status indicator shown while the agent executes a tool call */
export function ToolCallIndicator({ toolName, args }: { toolName: string; args: Record<string, unknown> }) {
  const label = describeToolCall(toolName, args);

  return (
    <div className="chat-message chat-message-assistant">
      <div className="chat-avatar">✦</div>
      <div className="chat-bubble">
        <div className="tool-call-indicator">
          <span className="tool-call-spinner" />
          <span className="tool-call-label">{label}</span>
        </div>
      </div>
    </div>
  );
}
