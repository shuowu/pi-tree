import { useState, useCallback, useEffect } from "react";
import { Rss, FileText, Settings, Plus, Trash2, RefreshCw, ExternalLink, ChevronRight, Clock } from "lucide-react";
import "./NewsDashboardPanel.css";

// ---------------------------------------------------------------------------
// TypeScript Interfaces
// ---------------------------------------------------------------------------

interface NewsDashboardPanelProps {
  onDefine: (term: string, context?: string) => void;
  onSendMessage?: (message: string) => void;
}

interface FeedConfig {
  id: string;
  name: string;
  url: string;
  tags: string[];
}

interface AggregatedSource {
  feedId: string;
  feedName: string;
  title: string;
  publishedAt: string | null;
  author: string | null;
  url?: string;
}

interface AggregatedRssGroup {
  representativeTitle: string;
  feeds: string[];
  feedIds: string[];
  earliestPublishedAt: string | null;
  latestPublishedAt: string | null;
  aggregateWeight: number;
  sources: AggregatedSource[];
  isCrossFeed: boolean;
  sourceCount: number;
}

interface ReportsList {
  analyses: string[];
  summaries: string[];
}

// Helper to format relative time (e.g., "2h ago", "yesterday")
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// Helper to query Honos API
const API_BASE = "http://localhost:3947"; // dev fallback or relative in prod

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || `HTTP error ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function NewsDashboardPanel({ onDefine, onSendMessage }: NewsDashboardPanelProps) {
  const [subTab, setSubTab] = useState<"stories" | "reports" | "feeds">("stories");
  
  // Data State
  const [feeds, setFeeds] = useState<FeedConfig[]>([]);
  const [stories, setStories] = useState<AggregatedRssGroup[]>([]);
  const [reports, setReports] = useState<ReportsList>({ analyses: [], summaries: [] });
  
  // Loading & Action State
  const [loading, setLoading] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Active Report View
  const [selectedReport, setSelectedReport] = useState<{ type: "analyses" | "summaries"; filename: string } | null>(null);
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // New Feed Form
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newFeedTags, setNewFeedTags] = useState("");

  // ---------------------------------------------------------------------------
  // Data Loaders
  // ---------------------------------------------------------------------------

  const loadFeeds = useCallback(async () => {
    try {
      const data = await apiFetch<FeedConfig[]>("/api/news/feeds");
      setFeeds(data);
    } catch (err: unknown) {
      console.error("Failed to load feeds:", err);
    }
  }, []);

  const loadStories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AggregatedRssGroup[]>("/api/news/aggregate?days=3");
      setStories(data);
    } catch (err: unknown) {
      setError("Failed to load aggregated stories.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const data = await apiFetch<ReportsList>("/api/news/reports");
      setReports(data);
    } catch (err: unknown) {
      console.error("Failed to load reports:", err);
    }
  }, []);

  useEffect(() => {
    loadFeeds();
    loadStories();
    loadReports();
  }, [loadFeeds, loadStories, loadReports]);

  // Load specific report content
  useEffect(() => {
    if (!selectedReport) {
      setReportContent(null);
      return;
    }
    setLoadingReport(true);
    apiFetch<{ success: boolean; content: string }>(
      `/api/news/reports/${selectedReport.type}/${selectedReport.filename}`
    )
      .then((data) => setReportContent(data.content))
      .catch((err) => console.error("Failed to load report content:", err))
      .finally(() => setLoadingReport(false));
  }, [selectedReport]);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleCrawl = async () => {
    setCrawling(true);
    try {
      await apiFetch("/api/news/crawl", { method: "POST" });
      await loadStories();
    } catch (err: unknown) {
      alert(`Crawl failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setCrawling(false);
    }
  };

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeedName || !newFeedUrl) return;

    try {
      const tagsArray = newFeedTags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);

      const id = newFeedName.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-");

      await apiFetch("/api/news/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: newFeedName,
          url: newFeedUrl,
          tags: tagsArray
        })
      });

      setNewFeedName("");
      setNewFeedUrl("");
      setNewFeedTags("");
      await loadFeeds();
    } catch (err: unknown) {
      alert(`Failed to add feed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDeleteFeed = async (id: string) => {
    if (!confirm("Are you sure you want to delete this feed subscription?")) return;
    try {
      await apiFetch(`/api/news/feeds/${id}`, { method: "DELETE" });
      await loadFeeds();
    } catch (err: unknown) {
      alert(`Failed to delete feed: ${err instanceof Error ? err.message : err}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="news-dashboard">
      <div className="news-dashboard-tabs">
        <button
          className={`news-dashboard-tab ${subTab === "stories" ? "active" : ""}`}
          onClick={() => { setSubTab("stories"); setSelectedReport(null); }}
        >
          <Rss size={14} />
          Feed Stories
        </button>
        <button
          className={`news-dashboard-tab ${subTab === "reports" ? "active" : ""}`}
          onClick={() => setSubTab("reports")}
        >
          <FileText size={14} />
          Saved Reports
        </button>
        <button
          className={`news-dashboard-tab ${subTab === "feeds" ? "active" : ""}`}
          onClick={() => { setSubTab("feeds"); setSelectedReport(null); }}
        >
          <Settings size={14} />
          Feeds Manager
        </button>
      </div>

      <div className="news-dashboard-content">
        {/* STORIES TAB */}
        {subTab === "stories" && (
          <div className="stories-tab">
            <div className="stories-header">
              <span className="stories-title">Aggregated News</span>
              <button
                className="btn-refresh"
                onClick={handleCrawl}
                disabled={crawling}
                title="Crawl RSS Feeds"
              >
                <RefreshCw size={14} className={crawling ? "spin" : ""} />
                {crawling ? "Syncing..." : "Sync Feeds"}
              </button>
            </div>

            {loading && <div className="news-loading">Deduplicating news feeds...</div>}
            
            {!loading && error && <div className="news-error">{error}</div>}

            {!loading && !error && stories.length === 0 && (
              <div className="news-empty">No stories cached. Press "Sync Feeds" to fetch RSS.</div>
            )}

            {!loading && stories.length > 0 && (
              <div className="stories-list">
                {stories.map((group, idx) => (
                  <div
                    key={idx}
                    className={`story-group ${group.isCrossFeed ? "cross-feed" : ""}`}
                    onClick={() => {
                      if (onSendMessage) {
                        onSendMessage(`Tell me more about: ${group.representativeTitle}`);
                      } else {
                        onDefine(group.representativeTitle);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="story-header">
                      <span className="story-title">
                        {group.representativeTitle}
                      </span>
                    </div>
                    
                    <div className="story-meta">
                      <span className="story-meta-sources">
                        {group.sources.map((s, sidx) => (
                          <a
                            key={sidx}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="story-source-link"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {s.feedName}
                            <ExternalLink size={10} />
                          </a>
                        ))}
                      </span>
                      {group.latestPublishedAt && (
                        <span className="story-meta-time">
                          <Clock size={10} />
                          {formatRelativeTime(group.latestPublishedAt)}
                        </span>
                      )}
                      {group.isCrossFeed && (
                        <span className="badge-cross-feed">Multi-source</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* REPORTS TAB */}
        {subTab === "reports" && (
          <div className="reports-tab">
            {selectedReport ? (
              <div className="report-viewer">
                <button className="btn-back" onClick={() => setSelectedReport(null)}>
                  ← Back to List
                </button>
                <h3 className="report-title">{selectedReport.filename.replace(".md", "").replace(/_/g, " ")}</h3>
                
                {loadingReport && <div className="news-loading">Loading report...</div>}
                
                {!loadingReport && reportContent && (
                  <div className="report-body markdown-body">
                    {reportContent.split("\n").map((line, lidx) => (
                      <p key={lidx}>{line}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="reports-list-view">
                <span className="section-title">Deep Dive Analyses</span>
                {reports.analyses.length === 0 ? (
                  <div className="news-empty">No deep dive reports saved yet. Ask the AI to save one!</div>
                ) : (
                  <div className="reports-grid">
                    {reports.analyses.map((filename) => (
                      <div
                        key={filename}
                        className="report-card"
                        onClick={() => setSelectedReport({ type: "analyses", filename })}
                      >
                        <FileText size={18} />
                        <span className="report-card-name">{filename.slice(11).replace(".md", "").replace(/_/g, " ")}</span>
                        <ChevronRight size={14} className="chevron" />
                      </div>
                    ))}
                  </div>
                )}

                <span className="section-title" style={{ marginTop: "1.5rem", display: "block" }}>Daily/Weekly Digests</span>
                {reports.summaries.length === 0 ? (
                  <div className="news-empty">No briefings or digests saved yet.</div>
                ) : (
                  <div className="reports-grid">
                    {reports.summaries.map((filename) => (
                      <div
                        key={filename}
                        className="report-card"
                        onClick={() => setSelectedReport({ type: "summaries", filename })}
                      >
                        <FileText size={18} />
                        <span className="report-card-name">{filename.slice(11).replace(".md", "").replace(/_/g, " ")}</span>
                        <ChevronRight size={14} className="chevron" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* FEEDS TAB */}
        {subTab === "feeds" && (
          <div className="feeds-tab">
            <form onSubmit={handleAddFeed} className="add-feed-form">
              <span className="section-title">Add RSS Feed</span>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Feed Name (e.g., Hacker News)"
                  value={newFeedName}
                  onChange={(e) => setNewFeedName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <input
                  type="url"
                  placeholder="Feed URL (e.g., https://news.ycombinator.com/rss)"
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Tags (comma-separated, e.g. tech, ai)"
                  value={newFeedTags}
                  onChange={(e) => setNewFeedTags(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-add">
                <Plus size={14} />
                Add Feed
              </button>
            </form>

            <span className="section-title" style={{ marginTop: "1.5rem", display: "block" }}>Active Subscriptions</span>
            <div className="feeds-list">
              {feeds.map((feed) => (
                <div key={feed.id} className="feed-item">
                  <div className="feed-details">
                    <span className="feed-name">{feed.name}</span>
                    <span className="feed-url" title={feed.url}>{feed.url}</span>
                    <div className="feed-tags">
                      {feed.tags.map((t) => (
                        <span key={t} className="feed-tag">#{t}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    className="btn-delete"
                    onClick={() => handleDeleteFeed(feed.id)}
                    title="Delete Subscription"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
