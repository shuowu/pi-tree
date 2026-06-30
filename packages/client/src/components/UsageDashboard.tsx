import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import type { Source } from "@pi-tree/shared";
import { fetchUserUsage, fetchSourceUsage, fetchSources, type UsageStats } from "../api";
import { useUser } from "../UserContext";
import { Home, Zap, ArrowUpDown, MessageSquare, DollarSign, Cpu, BookOpen } from "lucide-react";
import { Breadcrumb } from "@pi-tree/ui";
import "./UsageDashboard.css";

/** Format a number with K/M suffixes */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function formatTokensFull(n: number): string {
  return n.toLocaleString();
}

type TimeRange = "today" | "7d" | "30d" | "all";

function getDateRange(range: TimeRange): { from?: string; to?: string } {
  if (range === "all") return {};
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now);
  if (range === "today") from.setHours(0, 0, 0, 0);
  else if (range === "7d") from.setDate(from.getDate() - 7);
  else if (range === "30d") from.setDate(from.getDate() - 30);
  return { from: from.toISOString(), to };
}

interface SourceUsageRow {
  source: Source;
  usage: UsageStats;
}

export function UsageDashboard() {
  const navigate = useNavigate();
  const { userId } = useUser();
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [sourceUsages, setSourceUsages] = useState<SourceUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  // Fetch global usage
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    const range = getDateRange(timeRange);
    fetchUserUsage(userId, range).then((data) => {
      if (!cancelled) {
        setUsage(data);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [userId, timeRange]);

  // Fetch per-source usage
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setSourcesLoading(true);
    const range = getDateRange(timeRange);
    (async () => {
      try {
        const sources = await fetchSources();
        const results = await Promise.all(
          sources.map(async (source) => {
            const u = await fetchSourceUsage(userId, source.id, range).catch(() => ({
              inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
              cacheWriteTokens: 0, totalTokens: 0, messageCount: 0, byModel: {},
            }));
            return { source, usage: u };
          }),
        );
        if (!cancelled) {
          // Sort by total tokens desc, filter out zero-usage
          setSourceUsages(results.filter(r => r.usage.totalTokens > 0).sort((a, b) => b.usage.totalTokens - a.usage.totalTokens));
          setSourcesLoading(false);
        }
      } catch {
        if (!cancelled) setSourcesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, timeRange]);

  const modelEntries = useMemo(() => {
    if (!usage) return [];
    return Object.entries(usage.byModel)
      .sort(([, a], [, b]) => b.totalTokens - a.totalTokens);
  }, [usage]);

  const panelToggles = useMemo(() => [
    { id: "home", icon: <Home size={16} />, label: "Home", active: false, onClick: () => navigate("/") },
  ], [navigate]);

  const inputRatio = usage && usage.totalTokens > 0
    ? Math.round((usage.inputTokens / usage.totalTokens) * 100)
    : 0;

  return (
    <div className="usage-dashboard">
      <Breadcrumb
        items={[]}
        onNavigate={() => {}}
        bookTitle="Usage Dashboard"
        isScoped={false}
        panelToggles={panelToggles}
      />

      <div className="usage-content">
        {/* Time range selector */}
        <div className="usage-time-range">
          {(["today", "7d", "30d", "all"] as TimeRange[]).map((range) => (
            <button
              key={range}
              className={`usage-time-btn ${timeRange === range ? "active" : ""}`}
              onClick={() => setTimeRange(range)}
            >
              {range === "today" ? "Today" : range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "All Time"}
            </button>
          ))}
        </div>

        {/* Summary cards */}
        {loading ? (
          <div className="usage-loading">Loading usage data…</div>
        ) : !usage || usage.totalTokens === 0 ? (
          <div className="usage-empty">
            <Zap size={48} />
            <h3>No usage data yet</h3>
            <p>Start a conversation to see your token usage here.</p>
          </div>
        ) : (
          <>
            <div className="usage-summary-grid">
              <div className="usage-card">
                <div className="usage-card-icon"><Zap size={20} /></div>
                <div className="usage-card-content">
                  <span className="usage-card-value">{formatTokens(usage.totalTokens)}</span>
                  <span className="usage-card-label">Total Tokens</span>
                </div>
                <span className="usage-card-detail">{formatTokensFull(usage.totalTokens)}</span>
              </div>

              <div className="usage-card">
                <div className="usage-card-icon"><ArrowUpDown size={20} /></div>
                <div className="usage-card-content">
                  <span className="usage-card-value">{inputRatio}% / {100 - inputRatio}%</span>
                  <span className="usage-card-label">Input / Output</span>
                </div>
                <span className="usage-card-detail">{formatTokens(usage.inputTokens)} in · {formatTokens(usage.outputTokens)} out</span>
              </div>

              <div className="usage-card">
                <div className="usage-card-icon"><MessageSquare size={20} /></div>
                <div className="usage-card-content">
                  <span className="usage-card-value">{usage.messageCount}</span>
                  <span className="usage-card-label">Messages</span>
                </div>
                <span className="usage-card-detail">AI responses tracked</span>
              </div>

              {usage.costTotal != null && usage.costTotal > 0 && (
                <div className="usage-card usage-card-cost">
                  <div className="usage-card-icon"><DollarSign size={20} /></div>
                  <div className="usage-card-content">
                    <span className="usage-card-value">${usage.costTotal.toFixed(3)}</span>
                    <span className="usage-card-label">Total Cost</span>
                  </div>
                </div>
              )}
            </div>

            {/* Cache stats */}
            {(usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) && (
              <div className="usage-cache-bar">
                <span className="usage-cache-label">Prompt Caching</span>
                <span className="usage-cache-stat">{formatTokens(usage.cacheReadTokens)} read</span>
                <span className="usage-cache-sep">·</span>
                <span className="usage-cache-stat">{formatTokens(usage.cacheWriteTokens)} written</span>
              </div>
            )}

            {/* By Model breakdown */}
            {modelEntries.length > 0 && (
              <section className="usage-section">
                <h3 className="usage-section-title"><Cpu size={16} /> By Model</h3>
                <div className="usage-model-grid">
                  {modelEntries.map(([model, stats]) => {
                    const pct = usage.totalTokens > 0
                      ? Math.round((stats.totalTokens / usage.totalTokens) * 100)
                      : 0;
                    return (
                      <div key={model} className="usage-model-card">
                        <div className="usage-model-header">
                          <span className="usage-model-name">{model}</span>
                          <span className="usage-model-pct">{pct}%</span>
                        </div>
                        <div className="usage-model-bar">
                          <div className="usage-model-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="usage-model-stats">
                          <span>{formatTokens(stats.totalTokens)} tokens</span>
                          <span>{stats.messageCount} msgs</span>
                          <span>{formatTokens(stats.inputTokens)} in / {formatTokens(stats.outputTokens)} out</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* By Source breakdown */}
            <section className="usage-section">
              <h3 className="usage-section-title"><BookOpen size={16} /> By Source</h3>
              {sourcesLoading ? (
                <div className="usage-loading">Loading source usage…</div>
              ) : sourceUsages.length === 0 ? (
                <div className="usage-empty-inline">No per-source data available.</div>
              ) : (
                <div className="usage-source-list">
                  {sourceUsages.map(({ source, usage: su }) => {
                    const pct = usage.totalTokens > 0
                      ? Math.round((su.totalTokens / usage.totalTokens) * 100)
                      : 0;
                    return (
                      <div key={source.id} className="usage-source-row" onClick={() => navigate(`/source/${source.id}`)}>
                        <div className="usage-source-info">
                          <span className="usage-source-title">{source.title}</span>
                          <span className="usage-source-type">{source.type}</span>
                        </div>
                        <div className="usage-source-bar-container">
                          <div className="usage-source-bar">
                            <div className="usage-source-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="usage-source-stats">
                          <span className="usage-source-tokens">{formatTokens(su.totalTokens)}</span>
                          <span className="usage-source-msgs">{su.messageCount} msgs</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
