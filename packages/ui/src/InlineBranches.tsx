import { useEffect, useMemo, useRef, useState } from "react";
import { useMermaid } from "./hooks/useMermaid.js";
import type { ChatMessage, BranchOption } from "@pi-tree/core/types";
import "./marked-config.js"; // side-effect: registers KaTeX + link extensions
import { marked } from "marked";

/** Data returned when fetching a branch's content for inline preview */
export interface BranchPreviewData {
  messages: ChatMessage[];
  branches: BranchOption[];
}

interface InlineBranchesProps {
  branches: BranchOption[];
  onDrillDown: (nodeId: string) => void;
  bookId: string;
  sessionId: number | null;
  /** Branch IDs that were just created (e.g. from a streaming response).
   *  These default to expanded regardless of the user's collapse preference. */
  newBranchIds: Set<string>;
  /** User ID for branch preview fetches */
  userId: string;
  /** Whether branches should default to collapsed (default: true) */
  defaultCollapsed?: boolean;
  /** Fetch branch preview data for inline display.
   *  Called with (userId, bookId, sessionId, nodeId). */
  fetchBranchPreview?: (
    userId: string,
    bookId: string,
    sessionId: number,
    nodeId: string,
  ) => Promise<BranchPreviewData>;
}

export function InlineBranches({
  branches,
  onDrillDown,
  bookId,
  sessionId,
  newBranchIds,
  userId,
  defaultCollapsed: defaultCollapsedProp,
  fetchBranchPreview,
}: InlineBranchesProps) {
  const defaultCollapsed = defaultCollapsedProp ?? true;
  const [branchData, setBranchData] = useState<
    Record<string, { messages: ChatMessage[]; branches: BranchOption[] }>
  >({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  // Initialize collapse state from user preference, but expand new branches
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      branches.map((b) => [b.nodeId, newBranchIds.has(b.nodeId) ? false : defaultCollapsed]),
    ),
  );

  // Auto-fetch all branch data on mount / when branches change
  useEffect(() => {
    if (!fetchBranchPreview) return;

    const fetchAll = async () => {
      for (const b of branches) {
        if (branchData[b.nodeId]) continue; // already loaded
        setLoading((prev) => ({ ...prev, [b.nodeId]: true }));
        try {
          if (!userId || sessionId === null) continue;
          const state = await fetchBranchPreview(userId, bookId, sessionId, b.nodeId);
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
    <div className="pit-inline-branches">
      <div className="pit-inline-branches-divider">
        <span className="pit-inline-branches-label">
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
          <div key={b.nodeId} className="pit-inline-branch">
            {/* Branch action bar */}
            <div className="pit-inline-branch-header">
              <button
                className="pit-inline-branch-collapse"
                onClick={() => setCollapsed((prev) => ({ ...prev, [b.nodeId]: !isCollapsed }))}
                aria-label={isCollapsed ? "Expand" : "Collapse"}
              >
                <span className={`pit-inline-branch-chevron ${isCollapsed ? "" : "pit-expanded"}`}>›</span>
              </button>
              <span className={`pit-branch-dot pit-status-${b.status}`} />
              <span className="pit-inline-branch-title">
                {b.label}
              </span>
              {b.messageCount > 0 && (
                <span className="pit-branch-count">{b.messageCount}</span>
              )}
              <button
                className="pit-inline-branch-open"
                onClick={() => onDrillDown(b.nodeId)}
                title="Open this branch"
              >
                Open →
              </button>
            </div>

            {/* Branch content — message-like rendering */}
            {!isCollapsed && (
              <div className="pit-inline-branch-content">
                {isLoading && (
                  <div className="pit-chat-message pit-chat-message-assistant">
                    <div className="pit-chat-avatar">✦</div>
                    <div className="pit-chat-bubble">
                      <div className="pit-chat-loading">
                        <span className="pit-dot" /><span className="pit-dot" /><span className="pit-dot" />
                      </div>
                    </div>
                  </div>
                )}

                {userMsg && (
                  <div className="pit-chat-message pit-chat-message-user">
                    <div className="pit-chat-bubble">
                      <div className="pit-chat-content">{userMsg.content}</div>
                    </div>
                  </div>
                )}

                {aiMsg && (
                  <InlineAIMessage content={aiMsg.content} />
                )}

                {/* Sub-branches indicator */}
                {data?.branches && data.branches.length > 0 && (() => {
                  const visibleSubs = data.branches.filter(
                    (sub) => !(sub.status === "placeholder" && (sub.messageCount ?? 0) === 0),
                  );
                  if (visibleSubs.length === 0) return null;
                  return (
                    <div className="pit-inline-branch-sub">
                      {visibleSubs.map((sub) => (
                        <button
                          key={sub.nodeId}
                          className="pit-inline-branch-sub-item"
                          onClick={() => onDrillDown(sub.nodeId)}
                        >
                          <span className={`pit-branch-dot pit-status-${sub.status}`} />
                          {sub.label}
                          <span className="pit-inline-branch-arrow">→</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
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
    <div className="pit-chat-message pit-chat-message-assistant">
      <div className="pit-chat-avatar">✦</div>
      <div className="pit-chat-bubble">
        <div
          ref={contentRef}
          className="pit-chat-content pit-markdown"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
