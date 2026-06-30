import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { Loader2, ArrowUp, Rss, Hash } from "lucide-react";
import { Marked } from "marked";
import { fetchRouterSession, sendMessageStreaming, routeDeterministic } from "../api";
import { useSourceMentions, parseMentionQuery, type MentionSuggestion } from "../hooks/useSourceMentions";
import { getSourceTypeConfig } from "../source-types";
import { formatErrorMessage } from "../utils/formatError";
import "./RouterChat.css";

const marked = new Marked({
  renderer: {
    link({ href, text }) {
      return `<a href="${href}" data-router-link>${text}</a>`;
    },
    paragraph({ text }) {
      return `${text}\n`;
    },
  },
});

/** Pick icon component by mention kind + source type */
function MentionIcon({ suggestion }: { suggestion: MentionSuggestion }) {
  if (suggestion.kind === "feed") return <Rss size={14} />;
  if (suggestion.kind === "tag") return <Hash size={14} />;
  if (suggestion.kind === "category") {
    const config = getSourceTypeConfig(suggestion.type ?? "");
    const Icon = config.icon;
    return <Icon size={14} />;
  }
  // Source kind — pick by source type
  const config = getSourceTypeConfig(suggestion.type ?? "");
  const Icon = config.icon;
  return <Icon size={14} />;
}

interface RouterChatProps {
  userId: string;
}

export function RouterChat({ userId }: RouterChatProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const msgIdCounter = useRef(0);
  const nextMsgId = () => ++msgIdCounter.current;
  const [messages, setMessages] = useState<Array<{ id: number; role: "user" | "assistant"; content: string }>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ sessionKey: string } | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // @ mention state
  const [mentionQuery, setMentionQuery] = useState<{ query: string; startIndex: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const { ensureLoaded, filterItems } = useSourceMentions();

  const mentionSuggestions = useMemo(() => {
    if (!mentionQuery) return [];
    return filterItems(mentionQuery.query);
  }, [mentionQuery, filterItems]);

  const messagesRef = useRef<HTMLDivElement>(null);
  // Structured result from create_session tool — no regex needed
  const pendingNavigation = useRef<string | null>(null);

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

  // Auto-scroll within the messages container (not the page)
  useEffect(() => {
    const container = messagesRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, activeToolCall]);

  // Intercept clicks on internal links
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

  const renderedMessages = useMemo(() => {
    return messages.map((msg) => {
      if (msg.role === "assistant") {
        return { ...msg, html: marked.parse(msg.content) as string };
      }
      return { ...msg, html: "" };
    });
  }, [messages]);

  // Handle input changes — detect @mention
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    const cursorPos = e.target.selectionStart ?? value.length;
    const mention = parseMentionQuery(value, cursorPos);
    if (mention) {
      ensureLoaded();
      setMentionQuery(mention);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, [ensureLoaded]);

  // Insert a selected mention into the input
  const insertMention = useCallback((suggestion: MentionSuggestion) => {
    if (!mentionQuery) return;
    const before = input.slice(0, mentionQuery.startIndex);
    const after = input.slice(inputRef.current?.selectionStart ?? input.length);
    const newInput = `${before}${suggestion.insertText} ${after}`;
    setInput(newInput);
    setMentionQuery(null);
    // Restore focus and cursor
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const pos = before.length + suggestion.insertText.length + 1; // +1 for trailing space
        el.setSelectionRange(pos, pos);
      }
    });
  }, [input, mentionQuery]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      // If mention dropdown is open and user presses Enter, select the mention
      if (mentionQuery && mentionSuggestions.length > 0) {
        insertMention(mentionSuggestions[mentionIndex]);
        return;
      }

      const trimmed = input.trim();
      if (!trimmed || isStreaming || !sessionInfo) return;

      const userMsg = { id: nextMsgId(), role: "user" as const, content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsStreaming(true);
      setIsExpanded(true);
      pendingNavigation.current = null;

      // Try deterministic routing first (skips LLM for @mentions)
      (async () => {
        try {
          const routeResult = await routeDeterministic(userId, trimmed);
          if (routeResult.resolved && routeResult.url) {
            setMessages((prev) => [
              ...prev,
              { id: nextMsgId(), role: "assistant" as const, content: `Opening **${routeResult.sourceTitle ?? "session"}**…` },
            ]);
            setIsStreaming(false);
            setIsRedirecting(true);
            setTimeout(() => navigate(routeResult.url!), 400);
            return;
          }
        } catch {
          // Deterministic routing failed — fall through to LLM
        }

        // LLM-based routing fallback
        sendMessageStreaming(
          userId,
          "_system_router_router",
          0,
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
                return [...prev, { id: nextMsgId(), role: "assistant", content: token }];
              });
            },
            onToolCall({ toolName }) {
              setActiveToolCall(toolName);
            },
            onToolResult({ toolName, result, isError }) {
              // When create_session or open_session completes, capture the URL
              if ((toolName === "create_session" || toolName === "open_session") && !isError && result) {
                try {
                  const parsed = typeof result === "string" ? JSON.parse(result) : result;
                  // The tool returns { content: [{ type: "text", text: "{...}" }] }
                  // or the result may be the parsed text directly
                  let data = parsed;
                  if (parsed?.content?.[0]?.text) {
                    data = JSON.parse(parsed.content[0].text);
                  }
                  if (data?.url) {
                    pendingNavigation.current = data.url;
                  }
                } catch {
                  // Fall through
                }
              }
            },
            onTurnEnd() {
              setActiveToolCall(null);
            },
            onDone() {
              setIsStreaming(false);
              setActiveToolCall(null);

              // Auto-redirect if create_session returned a URL
              if (pendingNavigation.current) {
                const url = pendingNavigation.current;
                setIsRedirecting(true);
                setTimeout(() => {
                  navigate(url);
                }, 400);
              }
            },
            onError(err) {
              console.error("Router chat error:", err);
              setIsStreaming(false);
              setActiveToolCall(null);
              setMessages((prev) => [
                ...prev,
                { id: nextMsgId(), role: "assistant", content: `⚠️ ${formatErrorMessage(err.message)}` },
              ]);
            },
          },
          undefined,
          { sessionKey: sessionInfo.sessionKey },
        );
      })();
    },
    [input, isStreaming, sessionInfo, userId, navigate, mentionQuery, mentionSuggestions, mentionIndex, insertMention],
  );

  // Handle keyboard navigation in mention dropdown
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery && mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionSuggestions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
  }, [mentionQuery, mentionSuggestions, mentionIndex, insertMention]);

  // Scroll selected mention item into view
  useEffect(() => {
    const el = mentionDropdownRef.current?.querySelector(".router-mention-item.selected");
    el?.scrollIntoView({ block: "nearest" });
  }, [mentionIndex]);

  return (
    <div className={`router-chat ${isExpanded ? "expanded" : ""}`}>
      {isExpanded && renderedMessages.length > 0 && (
        <div className="router-chat-messages" ref={messagesRef}>
          {renderedMessages.map((msg) => (
            <div key={msg.id} className={`router-msg router-msg-${msg.role}`}>
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

        </div>
      )}

      <form onSubmit={handleSubmit} className="router-chat-input-form">
        <div className="router-chat-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="What would you like to read or explore? Type @ to mention a source"
            disabled={isStreaming || isRedirecting}
            className="router-chat-input"
          />
          {/* @ mention dropdown */}
          {mentionQuery && mentionSuggestions.length > 0 && (
            <div className="router-mention-dropdown" ref={mentionDropdownRef}>
              {mentionSuggestions.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  className={`router-mention-item ${i === mentionIndex ? "selected" : ""} kind-${s.kind}`}
                  onClick={() => insertMention(s)}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <span className="router-mention-icon">
                    <MentionIcon suggestion={s} />
                  </span>
                  <span className="router-mention-text">
                    <span className="router-mention-title">{s.label}</span>
                    {s.sublabel && <span className="router-mention-meta">{s.sublabel}</span>}
                  </span>
                  {s.kind !== "source" && (
                    <span className={`router-mention-badge kind-${s.kind}`}>
                      {s.kind}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="submit" disabled={isStreaming || isRedirecting || !input.trim()} className="router-chat-send">
          {isStreaming ? <Loader2 className="spin" size={16} /> : <ArrowUp size={16} />}
        </button>
      </form>
    </div>
  );
}
