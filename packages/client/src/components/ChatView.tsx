import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@pi-reader/shared";
import { marked } from "marked";
import "./ChatView.css";

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface ChatViewProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (message: string) => void;
}

export function ChatView({ messages, isLoading, onSendMessage }: ChatViewProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  }, [input]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSendMessage(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-view">
      <div className="chat-messages">
        {messages.length === 0 && !isLoading && (
          <div className="chat-empty">
            <span className="chat-empty-icon">📚</span>
            <p>Starting your reading session…</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-avatar">✦</div>
            <div className="chat-bubble">
              <div className="chat-loading">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the book, or try: deep dive, next chapter, zoom out…"
            rows={1}
            disabled={isLoading}
          />
          <button
            className="chat-send"
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";

  const html = useMemo(() => {
    if (!isAssistant) return "";
    return marked.parse(message.content) as string;
  }, [message.content, isAssistant]);

  return (
    <div className={`chat-message chat-message-${message.role}`}>
      {isAssistant && <div className="chat-avatar">✦</div>}
      <div className="chat-bubble">
        {isAssistant ? (
          <div
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
