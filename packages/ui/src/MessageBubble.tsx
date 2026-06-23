import { useRef, useMemo } from "react";
import { useMermaid } from "./hooks/useMermaid.js";
import type { ChatMessage } from "@pi-tree/core/types";
import "./marked-config.js"; // side-effect: registers KaTeX + link extensions
import { marked } from "marked";

export function MessageBubble({
  message,
  onFork,
  isLoading,
}: {
  message: ChatMessage;
  onFork?: (nodeId: string) => void;
  isLoading?: boolean;
}) {
  const isAssistant = message.role === "assistant";
  const isUser = message.role === "user";
  const isMarkdown = isAssistant || (isUser && message.content.trim().startsWith(">"));
  const contentRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    if (!isMarkdown) return "";
    return marked.parse(message.content) as string;
  }, [message.content, isMarkdown]);

  useMermaid(contentRef, html);

  return (
    <div className={`pit-chat-message pit-chat-message-${message.role}`}>
      {isAssistant && <div className="pit-chat-avatar">✦</div>}
      <div className="pit-chat-bubble">
        {isMarkdown ? (
          <div
            ref={contentRef}
            className="pit-chat-content pit-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="pit-chat-content">{message.content}</div>
        )}
        {isAssistant && onFork && (
          <button
            className="pit-fork-btn"
            title="Fork conversation from here"
            disabled={isLoading}
            onClick={() => onFork(message.id)}
          >
            ⑂
          </button>
        )}
      </div>
    </div>
  );
}
