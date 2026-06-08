import { useEffect, useMemo, useRef, useState } from "react";
import { useMermaid } from "../hooks/useMermaid";
import type { ChatMessage, BranchOption } from "@pi-books/shared";
import { marked } from "marked";
import { useUser } from "../UserContext";
import { getBranchesCollapsed } from "../utils/preferences";

interface InlineBranchesProps {
  branches: BranchOption[];
  onDrillDown: (nodeId: string) => void;
  bookId: string;
  sessionId: number | null;
  /** Branch IDs that were just created (e.g. from a streaming response).
   *  These default to expanded regardless of the user's collapse preference. */
  newBranchIds: Set<string>;
}

export function InlineBranches({
  branches,
  onDrillDown,
  bookId,
  sessionId,
  newBranchIds,
}: InlineBranchesProps) {
  const { userId } = useUser();
  const [branchData, setBranchData] = useState<
    Record<string, { messages: ChatMessage[]; branches: BranchOption[] }>
  >({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  // Initialize collapse state from user preference, but expand new branches
  const defaultCollapsed = useMemo(() => getBranchesCollapsed(), []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      branches.map((b) => [b.nodeId, newBranchIds.has(b.nodeId) ? false : defaultCollapsed]),
    ),
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
