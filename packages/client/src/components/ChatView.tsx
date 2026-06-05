import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, BranchOption } from "@pi-reader/shared";
import { marked } from "marked";
import { SelectionToolbar } from "./SelectionToolbar";
import { BookOpen } from "lucide-react";
import { useUser } from "../UserContext";
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
  onSendMessage: (message: string) => void;
  branches: BranchOption[];
  onDrillDown: (nodeId: string) => void;
  /** Whether the user is viewing a scoped branch (not root) */
  isScoped: boolean;
  /** Book ID for dictionary lookups */
  bookId: string;
  /** Define handler — sends term to right sidebar */
  onDefine: (term: string) => void;
}

export function ChatView({
  messages,
  isLoading,
  isCompacting,
  streamingContent,
  onSendMessage,
  branches,
  onDrillDown,
  isScoped,
  bookId,
  onDefine,
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

  const handleAsk = useCallback(
    (text: string) => {
      setInput(`What does "${text}" mean in the context of this book?`);
      textareaRef.current?.focus();
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

        {isLoading && (streamingContent === null || streamingContent.length === 0) && (
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
          <InlineBranches branches={branches} onDrillDown={onDrillDown} bookId={bookId} />
        )}

        <SelectionToolbar
          containerRef={messagesContainerRef}
          onDefine={onDefine}
          onAsk={handleAsk}
        />

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

/** Live-updating bubble that renders partial markdown as it streams in */
function StreamingBubble({ content, isCompacting }: { content: string; isCompacting?: boolean }) {
  const html = useMemo(() => {
    return marked.parse(content) as string;
  }, [content]);

  return (
    <div className="chat-message chat-message-assistant">
      <div className="chat-avatar">✦</div>
      <div className="chat-bubble">
        <div
          className="chat-content markdown streaming"
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
}: {
  branches: BranchOption[];
  onDrillDown: (nodeId: string) => void;
  bookId: string;
}) {
  const { userId } = useUser();
  const [branchData, setBranchData] = useState<
    Record<string, { messages: ChatMessage[]; branches: BranchOption[] }>
  >({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Auto-fetch all branch data on mount / when branches change
  useEffect(() => {
    const fetchAll = async () => {
      const { viewScope } = await import("../api");
      for (const b of branches) {
        if (branchData[b.nodeId]) continue; // already loaded
        setLoading((prev) => ({ ...prev, [b.nodeId]: true }));
        try {
          if (!userId) continue;
          const state = await viewScope(userId, bookId, b.nodeId);
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
        const isCollapsed = collapsed[b.nodeId];
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
  const html = useMemo(() => {
    return marked.parse(content) as string;
  }, [content]);

  return (
    <div className="chat-message chat-message-assistant">
      <div className="chat-avatar">✦</div>
      <div className="chat-bubble">
        <div
          className="chat-content markdown"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

