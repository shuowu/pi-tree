import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { Loader2, ArrowUp } from "lucide-react";
import { Marked } from "marked";
import { fetchRouterSession, sendMessageStreaming } from "../api";
import "./RouterChat.css";

const marked = new Marked({
  renderer: {
    // Open links in same tab (internal navigation will be handled by click handler)
    link({ href, text }) {
      return `<a href="${href}" data-router-link>${text}</a>`;
    },
    // Remove wrapping <p> for compact display
    paragraph({ text }) {
      return `${text}\n`;
    },
  },
});

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
  const messagesRef = useRef<HTMLDivElement>(null);

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

  // Intercept clicks on internal links — use navigate() instead of full page load
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[data-router-link]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href && href.startsWith("/")) {
        e.preventDefault();
        navigate(href);
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [navigate]);

  // Render markdown for assistant messages
  const renderedMessages = useMemo(() => {
    return messages.map((msg) => {
      if (msg.role === "assistant") {
        return { ...msg, html: marked.parse(msg.content) as string };
      }
      return { ...msg, html: "" };
    });
  }, [messages]);

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
              const urlMatch = result.response.match(/\/source\/([\w-]+)\?session=(\d+)([&\w=]*)/);
              if (urlMatch) {
                setIsRedirecting(true);
                setTimeout(() => {
                  navigate(urlMatch[0]);
                }, 1200);
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
      {isExpanded && renderedMessages.length > 0 && (
        <div className="router-chat-messages" ref={messagesRef}>
          {renderedMessages.map((msg, i) => (
            <div key={i} className={`router-msg router-msg-${msg.role}`}>
              {msg.role === "assistant" ? (
                <div dangerouslySetInnerHTML={{ __html: msg.html }} />
              ) : (
                msg.content
              )}
            </div>
          ))}
          {activeToolCall && (
            <div className="router-tool-indicator">
              <Loader2 className="spin" size={14} /> {activeToolCall}…
            </div>
          )}
          {isRedirecting && (
            <div className="router-redirect-indicator">
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
