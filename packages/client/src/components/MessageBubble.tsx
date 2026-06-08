import { useRef, useMemo } from "react";
import { useMermaid } from "../hooks/useMermaid";
import type { ChatMessage } from "@pi-books/shared";
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
    <div className={`chat-message chat-message-${message.role}`}>
      {isAssistant && <div className="chat-avatar">✦</div>}
      <div className="chat-bubble">
        {isMarkdown ? (
          <div
            ref={contentRef}
            className="chat-content markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="chat-content">{message.content}</div>
        )}
      </div>
    </div>
  );
}
