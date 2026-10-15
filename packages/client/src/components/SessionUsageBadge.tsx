import { useEffect, useState, useRef } from "react";
import type { ContextUsage } from "@pi-tree/core/types";
import { fetchSessionUsage, type UsageStats } from "../api";
import { Zap } from "lucide-react";
import "./SessionUsageBadge.css";

interface SessionUsageBadgeProps {
  sessionId: number;
  /** Context fill of the viewed branch */
  contextUsage?: ContextUsage | null;
}

/** Format a number with K/M suffixes */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/** "12.4K / 32K" fill of the viewed branch's LLM context, warning near the limit. */
function ContextFill({ usage }: { usage: ContextUsage }) {
  const { tokens, contextWindow } = usage;
  const percent = tokens === null ? null : Math.min(100, (tokens / contextWindow) * 100);
  const level = percent === null ? "" : percent >= 90 ? " is-critical" : percent >= 70 ? " is-warning" : "";
  const title = percent === null
    ? "Context size of this branch is unknown until the next reply (it was just compacted)"
    : `This branch carries ~${tokens!.toLocaleString()} of ${contextWindow.toLocaleString()} context tokens (${percent.toFixed(0)}%)`;
  return (
    <span className={`session-usage-context${level}`} title={title}>
      <span className="session-usage-context-bar">
        <span style={{ width: `${percent ?? 0}%` }} />
      </span>
      {tokens === null ? "?" : formatTokens(tokens)} / {formatTokens(contextWindow)}
    </span>
  );
}

export function SessionUsageBadge({ sessionId, contextUsage }: SessionUsageBadgeProps) {
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchSessionUsage(sessionId);
        if (!cancelled) setUsage(data);
      } catch {
        // Silently fail
      }
    };
    load();
    // Refresh every 30 seconds to pick up new messages
    intervalRef.current = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
    };
  }, [sessionId]);

  const hasSpend = !!usage && usage.totalTokens > 0;
  if (!hasSpend && !contextUsage) return null;

  return (
    <div className="session-usage-badges">
      {contextUsage && (
        <div className="session-usage-badge">
          <ContextFill usage={contextUsage} />
        </div>
      )}
      {hasSpend && <SessionSpend usage={usage!} />}
    </div>
  );
}

/** Cumulative token spend across every branch of the session. */
function SessionSpend({ usage }: { usage: UsageStats }) {
  const models = Object.keys(usage.byModel);
  const modelLabel = models.length === 1 ? models[0].replace(/^(claude-|gpt-|gemini-)/, "").split("-").slice(0, 2).join("-") : `${models.length} models`;

  return (
    <div className="session-usage-badge" title={`Session total, all branches: ${usage.totalTokens.toLocaleString()} tokens across ${usage.messageCount} messages`}>
      <Zap size={12} />
      <span className="session-usage-tokens">{formatTokens(usage.totalTokens)}</span>
      <span className="session-usage-separator">·</span>
      <span className="session-usage-detail">{formatTokens(usage.inputTokens)} in / {formatTokens(usage.outputTokens)} out</span>
      {usage.costTotal != null && usage.costTotal > 0 && (
        <>
          <span className="session-usage-separator">·</span>
          <span className="session-usage-cost">${usage.costTotal.toFixed(3)}</span>
        </>
      )}
      <span className="session-usage-separator">·</span>
      <span className="session-usage-model">{modelLabel}</span>
    </div>
  );
}
