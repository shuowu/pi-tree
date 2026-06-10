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
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sawCreateSession = useRef(false);

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
      sawCreateSession.current = false;

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
                const updated = [...prev];
                updated[updated.length - 1] = { ...last, content: last.content + token };
                return updated;
              }
              return [...prev, { role: "assistant", content: token }];
            });
          },
          onToolCall({ toolName }) {
            setActiveToolCall(toolName);
            if (toolName === "create_session") {
              sawCreateSession.current = true;
            }
          },
          onTurnEnd() {
            setActiveToolCall(null);
          },
          onDone(result) {
            setIsStreaming(false);
            setActiveToolCall(null);

            // If create_session was called, extract the URL and auto-redirect
            if (sawCreateSession.current && result.response) {
              const urlMatch = result.response.match(/\/source\/([\w-]+)\?session=(\d+)(&new=\w+)?/);
              if (urlMatch) {
                setIsRedirecting(true);
                // Brief delay so the user sees the confirmation
                setTimeout(() => {
                  navigate(urlMatch[0]);
                }, 800);
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
    [input, isStreaming, sessionInfo, userId, navigate],
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
          {isRedirecting && (
            <div className="router-tool-indicator">
              <Loader2 className="spin" size={14} /> Opening session…
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="router-chat-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What would you like to read or explore?"
          disabled={isStreaming || isRedirecting}
          className="router-chat-input"
        />
        <button type="submit" disabled={isStreaming || isRedirecting || !input.trim()} className="router-chat-send">
          {isStreaming ? <Loader2 className="spin" size={16} /> : <ArrowUp size={16} />}
        </button>
      </form>
    </div>
  );
}
