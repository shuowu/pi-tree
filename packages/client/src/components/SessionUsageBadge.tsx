import { useEffect, useState, useRef } from "react";
import { fetchSessionUsage, type UsageStats } from "../api";
import { Zap } from "lucide-react";
import "./SessionUsageBadge.css";

interface SessionUsageBadgeProps {
  sessionId: number;
}

/** Format a number with K/M suffixes */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function SessionUsageBadge({ sessionId }: SessionUsageBadgeProps) {
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

  if (!usage || usage.totalTokens === 0) return null;

  const models = Object.keys(usage.byModel);
  const modelLabel = models.length === 1 ? models[0].replace(/^(claude-|gpt-|gemini-)/, "").split("-").slice(0, 2).join("-") : `${models.length} models`;

  return (
    <div className="session-usage-badge" title={`${usage.totalTokens.toLocaleString()} total tokens across ${usage.messageCount} messages`}>
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
