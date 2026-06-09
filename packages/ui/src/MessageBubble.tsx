import { useRef, useMemo } from "react";
import { useMermaid } from "./hooks/useMermaid.js";
import type { ChatMessage } from "@pi-tree/core/types";
import { marked } from "marked";

export function MessageBubble({ message }: { message: ChatMessage }) {
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
      </div>
    </div>
  );
}
