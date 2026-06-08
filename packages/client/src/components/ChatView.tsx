import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, BranchOption } from "@pi-books/shared";
import { SelectionToolbar } from "./SelectionToolbar";
import { MessageBubble } from "./MessageBubble";
import { StreamingBubble } from "./StreamingBubble";
import { InlineBranches } from "./InlineBranches";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { BookOpen, Cpu, ChevronDown, Loader } from "lucide-react";
import { fetchServerConfig } from "../api";
import { useScrollDirection, type ScrollDirection } from "../utils/useScrollDirection";
import "./ChatView.css";

interface ChatViewProps {
  messages: ChatMessage[];
  isLoading: boolean;
  isCompacting: boolean;
  /** Whether the request is queued behind another in-flight operation */
  isQueued: boolean;
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
  /** Counter incremented on explicit navigation — triggers scroll-to-top */
  scrollTopTrigger: number;
}

export function ChatView({
  messages,
  isLoading,
  isCompacting,
  isQueued,
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
  scrollTopTrigger,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const streamingBubbleRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasStreamingRef = useRef(false);
  const userJustSentRef = useRef(false);

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

  // ---------------------------------------------------------------------------
  // Scroll management
  // ---------------------------------------------------------------------------

  // Scroll to top when the parent signals a navigation event.
  // This is the ONLY place that auto-scrolls to top. Streaming completion
  // never increments scrollTopTrigger, so the user's scroll position is
  // preserved when a response finishes.
  const scrollTopTriggerRef = useRef(scrollTopTrigger);
  useEffect(() => {
    if (scrollTopTrigger !== scrollTopTriggerRef.current) {
      scrollTopTriggerRef.current = scrollTopTrigger;
      messagesContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [scrollTopTrigger]);

  // One-shot scroll: when streaming begins, scroll the streaming bubble's top
  // into view so the user sees the start of the response. After that, the user
  // is free to scroll wherever they want — no forced scrolling during streaming.
  useEffect(() => {
    const isActive = streamingContent !== null && streamingContent.length > 0;
    const justStarted = isActive && !wasStreamingRef.current;
    wasStreamingRef.current = isActive;

    if (justStarted && streamingBubbleRef.current) {
      streamingBubbleRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [streamingContent]);

  // After the user sends a message, scroll it into view so they see their
  // question positioned at the bottom with room below for the AI response.
  useEffect(() => {
    if (userJustSentRef.current) {
      userJustSentRef.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // ---------------------------------------------------------------------------
  // New branch detection — tracked here (persists) because InlineBranches
  // unmounts during loading. On navigation (scrollTopTrigger changes), all
  // branches are "existing". On streaming completion, branches not previously
  // seen are "new" and should default to expanded.
  // ---------------------------------------------------------------------------

  const prevBranchIdsRef = useRef<Set<string>>(new Set(branches.map((b) => b.nodeId)));

  const newBranchIds = useMemo(() => {
    // Navigation just happened — everything in the new scope is "existing"
    // eslint-disable-next-line react-hooks/refs
    if (scrollTopTrigger !== scrollTopTriggerRef.current) {
      return new Set<string>();
    }
    return new Set(
      // eslint-disable-next-line react-hooks/refs
      branches.filter((b) => !prevBranchIdsRef.current.has(b.nodeId)).map((b) => b.nodeId),
    );
  }, [branches, scrollTopTrigger]);

  useEffect(() => {
    prevBranchIdsRef.current = new Set(branches.map((b) => b.nodeId));
  }, [branches]);

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------

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
    if ((!trimmed && !quotedText) || isLoading) return;

    let finalMessage: string;
    if (quotedText) {
      const userPart = trimmed || "Explain this";
      finalMessage = `> ${quotedText}\n\n${userPart}`;
      setQuotedText(null);
    } else {
      finalMessage = trimmed;
    }

    onSendMessage(finalMessage);
    setInput("");
    userJustSentRef.current = true;
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
    ? "Press Enter to explain, or type your question…"
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
          <StreamingBubble ref={streamingBubbleRef} content={streamingContent} isCompacting={isCompacting} />
        )}

        {isLoading && activeToolCall && (
          <ToolCallIndicator toolName={activeToolCall.toolName} args={activeToolCall.args} />
        )}

        {isLoading && !activeToolCall && (streamingContent === null || streamingContent.length === 0) && (
          <div className="chat-message chat-message-assistant">
            <div className="chat-avatar">✦</div>
            <div className="chat-bubble">
              {isQueued ? (
                <div className="chat-queued">
                  <span className="queued-spinner" />
                  Finishing a response on another branch — yours is next
                </div>
              ) : (
                <div className="chat-loading">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              )}
            </div>
          </div>
        )}

        {branches.length > 0 && !isLoading && (
          <InlineBranches
            branches={branches}
            onDrillDown={onDrillDown}
            bookId={bookId}
            sessionId={sessionId}
            newBranchIds={newBranchIds}
          />
        )}

        <SelectionToolbar
          containerRef={messagesContainerRef}
          onDefine={onDefine}
          onAsk={handleAsk}
        />

        <div ref={messagesEndRef} />

        {/* Scroll-to-bottom FAB — standard chat UX (Slack, Discord, WhatsApp)
         * Hidden while the streaming banner is visible to avoid redundancy. */}
        {!isNearBottom && !(isLoading && streamingContent !== null && streamingContent.length > 0) && (
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
        {/* Streaming progress banner — positioned above the input area.
         * Lives outside the scroll container so it's always visible as a
         * floating overlay, regardless of scroll position. */}
        {isLoading && streamingContent !== null && streamingContent.length > 0 && !isNearBottom && (
          <button
            className="streaming-progress-banner"
            onClick={scrollToBottom}
          >
            <Loader size={14} className="streaming-progress-spinner" />
            <span>Generating response…</span>
            <ChevronDown size={14} />
          </button>
        )}
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
                <span className="chat-quote-text">"{quotedText}"</span>
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
