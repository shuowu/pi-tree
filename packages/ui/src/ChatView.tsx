import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, BranchOption } from "@pi-tree/core/types";
import { MessageBubble } from "./MessageBubble.js";
import { StreamingBubble } from "./StreamingBubble.js";
import { InlineBranches, type BranchPreviewData } from "./InlineBranches.js";
import { ToolCallIndicator } from "./ToolCallIndicator.js";
import { ModelPicker, type ModelInfo } from "./ModelPicker.js";
import { BookOpen, ChevronDown, Loader, Square } from "lucide-react";
import { useScrollDirection, type ScrollDirection } from "./hooks/useScrollDirection.js";
import "./styles/ChatView.css";

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
  /** User ID for branch preview fetches */
  userId: string;
  /** Define handler — sends term + surrounding context to right sidebar */
  onDefine: (term: string, context?: string) => void;
  /** Reports scroll direction changes for shy-header behavior */
  onScrollDirectionChange?: (direction: ScrollDirection) => void;
  /** Counter incremented on explicit navigation — triggers scroll-to-top */
  scrollTopTrigger: number;
  /** Model name to display in the input area, if any */
  modelName?: string | null;
  /** Optional render prop for a selection toolbar (e.g., dictionary lookup) */
  renderSelectionToolbar?: (context: {
    containerRef: React.RefObject<HTMLDivElement | null>;
    onDefine: (term: string, context?: string) => void;
    onAsk: (text: string) => void;
  }) => React.ReactNode;
  /** Whether inline branch previews default to collapsed (default: true) */
  defaultBranchesCollapsed?: boolean;
  /** Fetch branch preview data for inline display.
   *  Called with (userId, bookId, sessionId, nodeId). */
  fetchBranchPreview?: (
    userId: string,
    bookId: string,
    sessionId: number,
    nodeId: string,
  ) => Promise<BranchPreviewData>;
  /** Custom placeholder text for the input (overrides default book-centric text) */
  placeholderText?: string;
  /** Welcome message shown when the session has no messages yet */
  welcomeMessage?: string | React.ReactNode;
  /** Available models for the model picker dropdown */
  availableModels?: ModelInfo[];
  /** Called when user selects a different model */
  onModelChange?: (modelId: string) => void;
  /** Called when user clicks fork on an assistant message */
  onFork?: (nodeId: string) => void;
  /** Called when the user wants to stop the current AI generation */
  onStop?: () => void;
  /** Ancestor messages from root to current scope for 'Show full path' */
  parentContext?: ChatMessage[];
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
  userId,
  onDefine,
  onScrollDirectionChange,
  scrollTopTrigger,
  modelName,
  renderSelectionToolbar,
  defaultBranchesCollapsed,
  fetchBranchPreview,
  placeholderText,
  welcomeMessage,
  availableModels,
  onModelChange,
  onFork,
  onStop,
  parentContext,
}: ChatViewProps) {
  const [input, setInput] = useState("");
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [showAncestors, setShowAncestors] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const streamingBubbleRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasStreamingRef = useRef(false);


  // Client-side filter: hide unused placeholder branches from the user.
  // An unused placeholder has status="placeholder" and messageCount=0.
  const visibleBranches = useMemo(
    () => branches.filter((b) => !(b.status === "placeholder" && (b.messageCount ?? 0) === 0)),
    [branches],
  );

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
      setShowAncestors(false); // Collapse ancestors on navigation
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

  // When a new user message appears (from input OR external send like content panel),
  // scroll it into view so the user sees their question with room below for the response.
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (messages.length > prevCount) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === "user") {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
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
        : placeholderText ?? "Ask about the book, or try: deep dive, next chapter, zoom out…";

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
    <div className="pit-chat-view">
      <div className="pit-chat-messages" ref={messagesContainerRef} style={{ position: "relative" }}>
        {messages.length === 0 && !isLoading && (
          <div className="pit-chat-empty">
            {typeof welcomeMessage === "string" ? (
              <><BookOpen size={32} className="pit-chat-empty-icon" strokeWidth={1.5} /><p>{welcomeMessage}</p></>
            ) : welcomeMessage ? (
              welcomeMessage
            ) : (
              <><BookOpen size={32} className="pit-chat-empty-icon" strokeWidth={1.5} /><p>Start a conversation…</p></>
            )}
          </div>
        )}

        {parentContext && parentContext.length > 0 && (
          <div className="pit-ancestor-toggle">
            <button
              className="pit-ancestor-toggle-btn"
              onClick={() => setShowAncestors((v) => !v)}
            >
              {showAncestors ? "▾ Hide parent context" : `▸ Show parent context (${parentContext.length} messages)`}
            </button>
            {showAncestors && (
              <>
                <div className="pit-ancestor-messages">
                  {parentContext.map((msg) => (
                    <MessageBubble key={`ancestor-${msg.id}`} message={msg} />
                  ))}
                </div>
                <div className="pit-scope-separator">Current branch</div>
              </>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onFork={onFork ?? onDrillDown} />
        ))}

        {isLoading && streamingContent !== null && streamingContent.length > 0 && (
          <StreamingBubble ref={streamingBubbleRef} content={streamingContent} isCompacting={isCompacting} />
        )}

        {isLoading && activeToolCall && (
          <ToolCallIndicator toolName={activeToolCall.toolName} args={activeToolCall.args} />
        )}

        {isLoading && !activeToolCall && (streamingContent === null || streamingContent.length === 0) && (
          <div className="pit-chat-message pit-chat-message-assistant">
            <div className="pit-chat-avatar">✦</div>
            <div className="pit-chat-bubble">
              {isQueued ? (
                <div className="pit-chat-queued">
                  <span className="pit-queued-spinner" />
                  Finishing a response on another branch — yours is next
                </div>
              ) : (
                <div className="pit-chat-loading">
                  <span className="pit-dot" />
                  <span className="pit-dot" />
                  <span className="pit-dot" />
                </div>
              )}
            </div>
          </div>
        )}

        {visibleBranches.length > 0 && !isLoading && (
          <InlineBranches
            branches={visibleBranches}
            onDrillDown={onDrillDown}
            bookId={bookId}
            sessionId={sessionId}
            userId={userId}
            newBranchIds={newBranchIds}
            defaultCollapsed={defaultBranchesCollapsed}
            fetchBranchPreview={fetchBranchPreview}
          />
        )}

        {renderSelectionToolbar?.({
          containerRef: messagesContainerRef,
          onDefine,
          onAsk: handleAsk,
        })}

        <div ref={messagesEndRef} />

        {/* Scroll-to-bottom FAB — standard chat UX (Slack, Discord, WhatsApp)
         * Hidden while the streaming banner is visible to avoid redundancy. */}
        {!isNearBottom && !(isLoading && streamingContent !== null && streamingContent.length > 0) && (
          <button
            className="pit-scroll-to-bottom"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <ChevronDown size={20} />
          </button>
        )}
      </div>

      <div className="pit-chat-input-container">
        {/* Streaming progress banner — positioned above the input area.
         * Lives outside the scroll container so it's always visible as a
         * floating overlay, regardless of scroll position. */}
        {isLoading && streamingContent !== null && streamingContent.length > 0 && !isNearBottom && (
          <button
            className="pit-streaming-progress-banner"
            onClick={scrollToBottom}
          >
            <Loader size={14} className="pit-streaming-progress-spinner" />
            <span>Generating response…</span>
            <ChevronDown size={14} />
          </button>
        )}
        {modelName && (
          <div className="pit-chat-input-meta">
            <ModelPicker
              currentModel={modelName}
              models={availableModels}
              onModelChange={onModelChange}
            />
          </div>
        )}
        <div className="pit-chat-input-area-wrapper">
          {quotedText && (
            <div className="pit-chat-quote-preview">
              <div className="pit-chat-quote-content">
                <span className="pit-chat-quote-label">Quote</span>
                <span className="pit-chat-quote-text">"{quotedText}"</span>
              </div>
              <button
                className="pit-chat-quote-remove"
                onClick={() => setQuotedText(null)}
                title="Remove quote"
              >
                ×
              </button>
            </div>
          )}
          <div className="pit-chat-input-wrapper">
            <textarea
              ref={textareaRef}
              className="pit-chat-input"
              data-testid="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              disabled={isLoading}
            />
            {isLoading && onStop ? (
              <button
                className="pit-chat-stop"
                onClick={onStop}
                aria-label="Stop generation"
                data-testid="chat-stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                className="pit-chat-send"
                onClick={handleSubmit}
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
                data-testid="chat-send"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
