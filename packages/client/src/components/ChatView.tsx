import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, BranchOption } from "@pi-reader/shared";
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
  branches: BranchOption[];
  onDrillDown: (nodeId: string) => void;
  /** Whether the user is viewing a scoped branch (not root) */
  isScoped: boolean;
}

export function ChatView({
  messages,
  isLoading,
  onSendMessage,
  branches,
  onDrillDown,
  isScoped,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMsgIdsRef = useRef<string>("");

  // Smart scroll: scroll to top on navigation, bottom on new message
  useEffect(() => {
    const currentIds = messages.map((m) => m.id).join(",");
    const prevIds = prevMsgIdsRef.current;
    prevMsgIdsRef.current = currentIds;

    if (!prevIds) {
      // Initial load — scroll to top
      messagesContainerRef.current?.scrollTo({ top: 0 });
      return;
    }

    if (currentIds.startsWith(prevIds) && currentIds !== prevIds) {
      // New message appended — scroll to bottom
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      // Different set of messages — navigated to new scope — scroll to top
      messagesContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [messages]);

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

  // Determine if typing will create a branch (scoped view with existing branches)
  const willBranch = isScoped && branches.length > 0;
  const placeholder = willBranch
    ? "New branch from this point…"
    : isScoped
      ? "Continue this thread…"
      : "Ask about the book, or try: deep dive, next chapter, zoom out…";

  return (
    <div className="chat-view">
      <div className="chat-messages" ref={messagesContainerRef}>
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

        {branches.length > 0 && !isLoading && (
          <div className="chat-branches">
            <div className="chat-branches-label">
              {branches.length} branch{branches.length > 1 ? "es" : ""} from here
            </div>
            <div className="chat-branches-grid">
              {branches.map((b) => (
                <button
                  key={b.nodeId}
                  className="chat-branch-card"
                  onClick={() => onDrillDown(b.nodeId)}
                >
                  <span className={`branch-dot status-${b.status}`} />
                  <span className="branch-label">{b.label}</span>
                  {b.messageCount > 0 && (
                    <span className="branch-count">{b.messageCount}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        {willBranch && (
          <div className="chat-branch-hint">
            ⑂ New branch — your message will start a new thread from this point
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
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
