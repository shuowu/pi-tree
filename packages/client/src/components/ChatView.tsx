import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMermaid } from "../hooks/useMermaid";
import type { ChatMessage, BranchOption } from "@pi-books/shared";
import { marked } from "marked";
import { SelectionToolbar } from "./SelectionToolbar";
import { BookOpen, Cpu, ChevronDown } from "lucide-react";
import { useUser } from "../UserContext";
import { fetchServerConfig } from "../api";
import { getBranchesCollapsed } from "../utils/preferences";
import { useScrollDirection, type ScrollDirection } from "../utils/useScrollDirection";
import "./ChatView.css";

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface ChatViewProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isCompacting: boolean;
  /** Partial content streaming in from AI, or null when not streaming */
  streamingContent: string | null;
  /** Currently executing tool call, or null when not in a tool call */
  activeToolCall: { toolName: string; args: Record<string, unknown> } | null;
  onSendMessage: (message: string) => void;
  branches: BranchOption[];
  onDrillDown: (nodeId: string) => void;
  /** Whether the user is viewing a scoped branch (not root) */
  isScoped: boolean;
  /** Book ID for dictionary lookups */
  bookId: string;
  /** Session ID for branch preview fetches */
  sessionId: number | null;
  /** Define handler — sends term + surrounding context to right sidebar */
  onDefine: (term: string, context?: string) => void;
  /** Reports scroll direction changes for shy-header behavior */
  onScrollDirectionChange?: (direction: ScrollDirection) => void;
}

export function ChatView({
  messages,
  isLoading,
  isCompacting,
  streamingContent,
  activeToolCall,
  onSendMessage,
  branches,
  onDrillDown,
  isScoped,
  bookId,
  sessionId,
  onDefine,
  onScrollDirectionChange,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevMsgIdsRef = useRef<string>("");

  // Scroll direction tracking for shy-header UX
  const scrollDir = useScrollDirection({ scrollRef: messagesContainerRef, threshold: 50 });
  const [isNearBottom, setIsNearBottom] = useState(true);

  useEffect(() => {
    if (scrollDir && onScrollDirectionChange) {
      onScrollDirectionChange(scrollDir);
    }
  }, [scrollDir, onScrollDirectionChange]);

  // Track whether user is near the bottom (for scroll-to-bottom button)
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsNearBottom(distanceFromBottom < 300);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Fetch model info once
  useEffect(() => {
    fetchServerConfig().then((cfg) => setModelName(cfg.readingModel));
  }, []);

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

  // Auto-scroll during streaming
  useEffect(() => {
    if (streamingContent !== null && streamingContent.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingContent]);

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

    let finalMessage = trimmed;
    if (quotedText) {
      finalMessage = `> ${quotedText}\n\n${trimmed}`;
      setQuotedText(null);
    }

    onSendMessage(finalMessage);
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
  const placeholder = quotedText
    ? "Ask a question about the quoted text…"
    : willBranch
      ? "New branch from this point…"
      : isScoped
        ? "Continue this thread…"
        : "Ask about the book, or try: deep dive, next chapter, zoom out…";

  const handleAsk = useCallback(
    (text: string) => {
      setQuotedText(text);
      // Focus in a timeout to let the selection toolbar unmount first
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    },
    [],
  );

  return (
    <div className="chat-view">
      <div className="chat-messages" ref={messagesContainerRef} style={{ position: "relative" }}>
        {messages.length === 0 && !isLoading && (
          <div className="chat-empty">
            <BookOpen size={32} className="chat-empty-icon" strokeWidth={1.5} />
            <p>Starting your reading session…</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && streamingContent !== null && streamingContent.length > 0 && (
          <StreamingBubble content={streamingContent} isCompacting={isCompacting} />
        )}

        {isLoading && activeToolCall && (
          <ToolCallIndicator toolName={activeToolCall.toolName} args={activeToolCall.args} />
        )}

        {isLoading && !activeToolCall && (streamingContent === null || streamingContent.length === 0) && (
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
          <InlineBranches branches={branches} onDrillDown={onDrillDown} bookId={bookId} sessionId={sessionId} />
        )}

        <SelectionToolbar
          containerRef={messagesContainerRef}
          onDefine={onDefine}
          onAsk={handleAsk}
        />

        <div ref={messagesEndRef} />

        {/* Scroll-to-bottom FAB — standard chat UX (Slack, Discord, WhatsApp) */}
        {!isNearBottom && (
          <button
            className="scroll-to-bottom"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <ChevronDown size={20} />
          </button>
        )}
      </div>

      <div className="chat-input-container">
        {modelName && (
          <div className="chat-input-meta">
            <span className="chat-model-badge"><Cpu size={11} /> {modelName}</span>
          </div>
        )}
        <div className="chat-input-area-wrapper">
          {quotedText && (
            <div className="chat-quote-preview">
              <div className="chat-quote-content">
                <span className="chat-quote-label">Quote</span>
                <span className="chat-quote-text">“{quotedText}”</span>
              </div>
              <button
                className="chat-quote-remove"
                onClick={() => setQuotedText(null)}
                title="Remove quote"
              >
                ×
              </button>
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
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
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

/**
 * Live-updating bubble that renders progressive markdown while streaming.
 * Industry-standard pattern (ChatGPT, Claude, Gemini): markdown renders in
 * real-time with a pulsing avatar + blinking cursor to signal generation.
 * When streaming ends, content moves to MessageBubble and indicators vanish.
 */
function StreamingBubble({ content, isCompacting }: { content: string; isCompacting?: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    return marked.parse(content) as string;
  }, [content]);

  // Skip mermaid during streaming — incomplete fences would produce errors.
  // Once streaming ends, content moves to MessageBubble which renders mermaid.
  useMermaid(contentRef, html, /* enabled */ false);

  return (
    <div className="chat-message chat-message-assistant streaming">
      <div className="chat-avatar">✦</div>
      <div className="chat-bubble">
        <div
          ref={contentRef}
          className="chat-content markdown"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {isCompacting && (
          <div className="compaction-indicator">
            <span className="compaction-dot" />
            Organizing reading notes…
          </div>
        )}
      </div>
    </div>
  );
}

function InlineBranches({
  branches,
  onDrillDown,
  bookId,
  sessionId,
}: {
  branches: BranchOption[];
  onDrillDown: (nodeId: string) => void;
  bookId: string;
  sessionId: number | null;
}) {
  const { userId } = useUser();
  const [branchData, setBranchData] = useState<
    Record<string, { messages: ChatMessage[]; branches: BranchOption[] }>
  >({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  // Initialize collapse state from user preference (default: collapsed)
  const defaultCollapsed = useMemo(() => getBranchesCollapsed(), []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(branches.map((b) => [b.nodeId, defaultCollapsed])),
  );

  // Auto-fetch all branch data on mount / when branches change
  useEffect(() => {
    const fetchAll = async () => {
      const { viewScope } = await import("../api");
      for (const b of branches) {
        if (branchData[b.nodeId]) continue; // already loaded
        setLoading((prev) => ({ ...prev, [b.nodeId]: true }));
        try {
          if (!userId || sessionId === null) continue;
          const state = await viewScope(userId, bookId, sessionId, b.nodeId);
          setBranchData((prev) => ({
            ...prev,
            [b.nodeId]: { messages: state.messages, branches: state.branches },
          }));
        } catch (err) {
          console.error("Failed to load branch:", err);
        } finally {
          setLoading((prev) => ({ ...prev, [b.nodeId]: false }));
        }
      }
    };
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branches.map((b) => b.nodeId).join(","), bookId]);

  return (
    <div className="inline-branches">
      <div className="inline-branches-divider">
        <span className="inline-branches-label">
          ⑂ {branches.length} branch{branches.length > 1 ? "es" : ""}
        </span>
      </div>

      {branches.map((b) => {
        const data = branchData[b.nodeId];
        const isCollapsed = collapsed[b.nodeId] ?? defaultCollapsed;
        const isLoading = loading[b.nodeId];

        // Find user and assistant messages from the branch data
        const userMsg = data?.messages.find((m) => m.role === "user");
        const aiMsg = data?.messages.find((m) => m.role === "assistant");

        return (
          <div key={b.nodeId} className="inline-branch">
            {/* Branch action bar */}
            <div className="inline-branch-header">
              <button
                className="inline-branch-collapse"
                onClick={() => setCollapsed((prev) => ({ ...prev, [b.nodeId]: !isCollapsed }))}
                aria-label={isCollapsed ? "Expand" : "Collapse"}
              >
                <span className={`inline-branch-chevron ${isCollapsed ? "" : "expanded"}`}>›</span>
              </button>
              <span className={`branch-dot status-${b.status}`} />
              <span className="inline-branch-title">
                {b.label}
              </span>
              {b.messageCount > 0 && (
                <span className="branch-count">{b.messageCount}</span>
              )}
              <button
                className="inline-branch-open"
                onClick={() => onDrillDown(b.nodeId)}
                title="Open this branch"
              >
                Open →
              </button>
            </div>

            {/* Branch content — message-like rendering */}
            {!isCollapsed && (
              <div className="inline-branch-content">
                {isLoading && (
                  <div className="chat-message chat-message-assistant">
                    <div className="chat-avatar">✦</div>
                    <div className="chat-bubble">
                      <div className="chat-loading">
                        <span className="dot" /><span className="dot" /><span className="dot" />
                      </div>
                    </div>
                  </div>
                )}

                {userMsg && (
                  <div className="chat-message chat-message-user">
                    <div className="chat-bubble">
                      <div className="chat-content">{userMsg.content}</div>
                    </div>
                  </div>
                )}

                {aiMsg && (
                  <InlineAIMessage content={aiMsg.content} />
                )}

                {/* Sub-branches indicator */}
                {data?.branches && data.branches.length > 0 && (
                  <div className="inline-branch-sub">
                    {data.branches.map((sub) => (
                      <button
                        key={sub.nodeId}
                        className="inline-branch-sub-item"
                        onClick={() => onDrillDown(sub.nodeId)}
                      >
                        <span className={`branch-dot status-${sub.status}`} />
                        {sub.label}
                        <span className="inline-branch-arrow">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** AI message rendered inside an inline branch — uses same style as regular chat */
function InlineAIMessage({ content }: { content: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    return marked.parse(content) as string;
  }, [content]);

  useMermaid(contentRef, html);

  return (
    <div className="chat-message chat-message-assistant">
      <div className="chat-avatar">✦</div>
      <div className="chat-bubble">
        <div
          ref={contentRef}
          className="chat-content markdown"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

/** Produce a human-readable label for a tool call */
function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  const path = (args.path ?? args.file ?? args.pattern ?? args.query ?? "") as string;
  const shortPath = path ? path.split("/").slice(-2).join("/") : "";

  switch (toolName) {
    case "read":
      return shortPath ? `Reading ${shortPath}` : "Reading book content";
    case "grep":
      return shortPath ? `Searching for "${shortPath}"` : "Searching content";
    case "find":
    case "ls":
      return shortPath ? `Browsing ${shortPath}` : "Browsing files";
    default:
      return `Running ${toolName}`;
  }
}

/** Compact status indicator shown while the agent executes a tool call */
function ToolCallIndicator({ toolName, args }: { toolName: string; args: Record<string, unknown> }) {
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

