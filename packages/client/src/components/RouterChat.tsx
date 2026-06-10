import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { Loader2, ArrowUp } from "lucide-react";
import { fetchRouterSession, sendMessageStreaming } from "../api";
import "./RouterChat.css";

interface RouterChatProps {
  userId: string;
}

export function RouterChat({ userId }: RouterChatProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: number; sourceId: string } | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);
  const [navigationUrl, setNavigationUrl] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch/create the router session on mount
  useEffect(() => {
    let cancelled = false;
    fetchRouterSession(userId)
      .then((info) => {
        if (!cancelled) setSessionInfo(info);
      })
      .catch((err) => {
        console.error("Failed to get router session:", err);
      });
    return () => { cancelled = true; };
  }, [userId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCall]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isStreaming || !sessionInfo) return;

      const userMsg = { role: "user" as const, content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsStreaming(true);
      setIsExpanded(true);
      setNavigationUrl(null);

      sendMessageStreaming(
        userId,
        sessionInfo.sourceId,
        sessionInfo.sessionId,
        trimmed,
        null,
        {
          onToken(token) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                // Append to existing assistant message
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, content: last.content + token };
                return updated;
              }
              // Create new assistant message
              return [...prev, { role: "assistant", content: token }];
            });
          },
          onToolCall({ toolName }) {
            setActiveToolCall(toolName);
          },
          onTurnEnd() {
            setActiveToolCall(null);
          },
          onDone(result) {
            setIsStreaming(false);
            setActiveToolCall(null);
            // Scan response text for session navigation URLs
            if (result.response) {
              const urlMatch = result.response.match(/\/source\/([\w-]+)\?session=(\d+)/);
              if (urlMatch) {
                setNavigationUrl(urlMatch[0]);
              }
            }
          },
          onError(err) {
            console.error("Router chat error:", err);
            setIsStreaming(false);
            setActiveToolCall(null);
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: `Error: ${err.message}` },
            ]);
          },
        },
      );
    },
    [input, isStreaming, sessionInfo, userId],
  );

  return (
    <div className={`router-chat ${isExpanded ? "expanded" : ""}`}>
      {/* Messages area — only shown when expanded */}
      {isExpanded && messages.length > 0 && (
        <div className="router-chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`router-msg router-msg-${msg.role}`}>
              {msg.content}
            </div>
          ))}
          {activeToolCall && (
            <div className="router-tool-indicator">
              <Loader2 className="spin" size={14} /> {activeToolCall}…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Navigation button if session was created */}
      {navigationUrl && (
        <button className="router-nav-btn" onClick={() => navigate(navigationUrl)}>
          Open Session →
        </button>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="router-chat-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What would you like to read or explore?"
          disabled={isStreaming}
          className="router-chat-input"
        />
        <button type="submit" disabled={isStreaming || !input.trim()} className="router-chat-send">
          {isStreaming ? <Loader2 className="spin" size={16} /> : <ArrowUp size={16} />}
        </button>
      </form>
    </div>
  );
}
