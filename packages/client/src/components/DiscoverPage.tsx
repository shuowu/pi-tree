import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Compass, Sparkles, BookOpen, ExternalLink, Loader2, RefreshCw, Rss, Plus, Check, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AppHeader } from "./AppHeader";
import { useUser } from "../UserContext.js";
import {
  fetchDiscoverConfig,
  fetchLatestDiscover,
  streamDiscover,
  addNewsFeed,
  addPaperSource,
  type DiscoverCandidate,
  type ReadingListConfigClient,
} from "../api.js";
import "./DiscoverPage.css";

/** Compact relative time, e.g. "just now", "12m ago", "3h ago", "2d ago". */
function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Display label + icon per source type, for the target selector. */
const TYPE_META: Record<string, { label: string; Icon: LucideIcon }> = {
  book: { label: "Books", Icon: BookOpen },
  news: { label: "Feeds", Icon: Rss },
  paper: { label: "Papers", Icon: FileText },
};

function typeMeta(t: string): { label: string; Icon: LucideIcon } {
  return TYPE_META[t] ?? { label: t.charAt(0).toUpperCase() + t.slice(1), Icon: Compass };
}

export function DiscoverPage() {
  const { userId } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [config, setConfig] = useState<ReadingListConfigClient | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<DiscoverCandidate[] | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    fetchDiscoverConfig()
      .then((cfg) => {
        setConfig(cfg);
        // Default to all types — but don't clobber a filter already set (e.g. by
        // a router intent like "book suggestions" via ?types=).
        if (cfg.availableSourceTypes?.length) {
          setSelectedTypes((prev) => (prev.size ? prev : new Set(cfg.availableSourceTypes)));
        }
      })
      .catch(() => setConfig(null))
      .finally(() => setConfigReady(true));
  }, []);

  // Load the last cached run so returning to Discover is instant.
  // Skipped when arriving via the router intent (?run=1) — that runs fresh.
  const cacheLoaded = useRef(false);
  useEffect(() => {
    if (cacheLoaded.current || !userId) return;
    if (searchParams.get("run") === "1") return;
    cacheLoaded.current = true;
    fetchLatestDiscover(userId)
      .then((cached) => {
        if (cached && cached.candidates?.length) {
          setCandidates(cached.candidates);
          setTopics(cached.topics ?? []);
          setGeneratedAt(cached.generatedAt ?? null);
          // Note: the type selector stays defaulted to all — it's a forward-looking
          // control for the next run, not a reflection of the cached results.
        }
      })
      .catch(() => {});
  }, [userId, searchParams]);

  const toggleType = useCallback((t: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const run = useCallback(async (typesOverride?: string[]) => {
    if (!userId || running) return;
    // A router-provided filter (e.g. "book suggestions" → ["book"]) drives both
    // the request and the chip selection so the UI reflects what ran.
    if (typesOverride && typesOverride.length) setSelectedTypes(new Set(typesOverride));
    setRunning(true);
    setError(null);
    setSteps([]);
    setCandidates(null);
    try {
      const types =
        typesOverride && typesOverride.length
          ? typesOverride
          : selectedTypes.size
            ? [...selectedTypes]
            : undefined;
      const { candidates, topics } = await streamDiscover(
        userId,
        (event) => {
          if (event.type === "status") {
            // Accumulate distinct steps; skip consecutive duplicates.
            setSteps((prev) => (prev[prev.length - 1] === event.message ? prev : [...prev, event.message]));
          }
        },
        types,
      );
      setCandidates(candidates);
      setTopics(topics);
      setGeneratedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRunning(false);
    }
  }, [userId, running, selectedTypes]);

  // Auto-run once when arriving via the router intent (/discover?run=1),
  // so "what should I read next?" goes straight to results. A plain nav
  // click to Discover has no ?run and just shows the button.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !configReady) return; // wait for config so types can be validated
    if (searchParams.get("run") === "1" && userId) {
      autoRan.current = true;
      // Validate ?types= against the known source types — ignore anything unknown
      // so a malformed URL can't put the selector in a bad state. Empty → all.
      const valid = new Set(config?.availableSourceTypes ?? []);
      const raw = (searchParams.get("types") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
      const filtered = valid.size ? raw.filter((t) => valid.has(t)) : raw;
      const types = filtered.length ? filtered : undefined;
      setSearchParams({}, { replace: true });
      run(types);
    }
  }, [searchParams, userId, configReady, config, run, setSearchParams]);

  const all = candidates ?? [];
  const books = all.filter((c) => c.kind === "acquire" && !c.addFeed && c.sourceType !== "paper");
  const papers = all.filter((c) => c.kind === "acquire" && c.sourceType === "paper");
  const feeds = all.filter((c) => c.kind === "acquire" && c.addFeed);
  const disabled = config?.mode === "off";

  return (
    <div className="discover-page">
      <AppHeader />

      <div className="discover-content">
        <div className="discover-header">
          <div className="discover-header-text">
            <h2 className="discover-title">Discover</h2>
            {candidates && generatedAt && !running ? (
              <span className="discover-generated">Generated {timeAgo(generatedAt)}</span>
            ) : (
              <span className="discover-subtitle">What to read next, grounded in what you've read.</span>
            )}
          </div>
          <button
            className="discover-run-btn"
            onClick={() => run()}
            disabled={running || disabled || !userId || selectedTypes.size === 0}
            title={disabled ? "Reading list is turned off in config" : undefined}
          >
            {running ? <Loader2 size={16} className="spin" /> : candidates ? <RefreshCw size={16} /> : <Sparkles size={16} />}
            <span>{running ? "Discovering…" : candidates ? "Refresh" : "Discover"}</span>
          </button>
        </div>

        {(config?.availableSourceTypes?.length ?? 0) > 1 && (
          <div className="discover-filter">
            <div className="discover-types">
              <span className="discover-types-label">Look for</span>
              {config!.availableSourceTypes!.map((t) => {
                const { label, Icon } = typeMeta(t);
                const on = selectedTypes.has(t);
                return (
                  <button
                    key={t}
                    className={`discover-type-chip ${on ? "active" : ""}`}
                    onClick={() => toggleType(t)}
                    aria-pressed={on}
                    disabled={running}
                  >
                    <Icon size={13} /> {label}
                  </button>
                );
              })}
            </div>
            <p className="discover-types-hint">Tap a chip to include or exclude that kind of source.</p>
          </div>
        )}

        {disabled && (
          <p className="discover-note">Reading list is disabled. Set <code>readingList.mode</code> to <code>on-demand</code> to enable it.</p>
        )}

        {running && (
          <div className="discover-steps">
            {steps.length === 0 && (
              <div className="discover-step current">
                <Loader2 size={13} className="spin" />
                <span>Starting…</span>
              </div>
            )}
            {steps.map((s, i) => {
              const isLast = i === steps.length - 1;
              return (
                <div key={i} className={`discover-step ${isLast ? "current" : "done"}`}>
                  {isLast ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                  <span>{s}</span>
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="discover-error">{error}</div>}

        {candidates && !running && (
          <>
            {topics.length > 0 && (
              <div className="discover-topics">
                <span className="discover-topics-label">Based on your interest in</span>
                {topics.slice(0, 8).map((t) => (
                  <span key={t} className="discover-topic-chip">{t}</span>
                ))}
              </div>
            )}

            {candidates.length === 0 && (
              <div className="discover-empty">
                <p>No suggestions yet. Load and read a few books first — the more you engage, the better these get.</p>
              </div>
            )}

            {books.length > 0 && (
              <section className="discover-section">
                <h2>Worth adding to your library</h2>
                <div className="discover-grid">
                  {books.map((c, i) => (
                    <CandidateCard key={`book-${i}`} candidate={c} />
                  ))}
                </div>
              </section>
            )}

            {papers.length > 0 && (
              <section className="discover-section">
                <h2>Papers worth reading</h2>
                <div className="discover-grid">
                  {papers.map((c, i) => (
                    <CandidateCard key={`paper-${i}`} candidate={c} />
                  ))}
                </div>
              </section>
            )}

            {feeds.length > 0 && (
              <section className="discover-section">
                <h2>Feeds worth following</h2>
                <div className="discover-grid">
                  {feeds.map((c, i) => (
                    <CandidateCard key={`feed-${i}`} candidate={c} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {!candidates && !running && !disabled && (
          <div className="discover-placeholder">
            <Sparkles size={40} strokeWidth={1} />
            <p>Press <strong>Discover</strong> to get suggestions for what to read next.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: DiscoverCandidate }) {
  const navigate = useNavigate();
  const meta = [candidate.author, candidate.year].filter(Boolean).join(" · ");
  const isFeed = Boolean(candidate.addFeed);
  const isPaper = candidate.kind === "acquire" && candidate.sourceType === "paper";
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);

  const handleAdd = useCallback(async () => {
    if (adding || added) return;
    setAdding(true);
    try {
      if (candidate.addFeed) {
        setAdded(await addNewsFeed(candidate.addFeed));
      } else if (isPaper) {
        const id = await addPaperSource({
          title: candidate.title,
          author: candidate.author,
          year: candidate.year,
          arxivId: candidate.ids?.arxiv,
        });
        setNewId(id);
        setAdded(Boolean(id));
      }
    } finally {
      setAdding(false);
    }
  }, [candidate, isPaper, adding, added]);

  return (
    <div className="discover-card">
      <div className="discover-card-cover">
        {candidate.coverUrl ? (
          <img src={candidate.coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="discover-card-cover-placeholder">
            {candidate.sourceType === "paper" ? (
              <FileText size={22} strokeWidth={1.2} />
            ) : isFeed ? (
              <Rss size={22} strokeWidth={1.2} />
            ) : (
              <BookOpen size={22} strokeWidth={1.2} />
            )}
          </div>
        )}
      </div>
      <div className="discover-card-body">
        <h3 className="discover-card-title">{candidate.title}</h3>
        {meta && <div className="discover-card-meta">{meta}</div>}
        <p className="discover-card-reason">{candidate.reason}</p>
        <div className="discover-card-actions">
          {isFeed ? (
            <>
              <button
                className={`discover-card-btn ${added ? "" : "primary"}`}
                onClick={handleAdd}
                disabled={adding || added}
              >
                {added ? <Check size={13} /> : adding ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                {added ? "Added to feeds" : adding ? "Adding…" : "Add feed"}
              </button>
              {candidate.url && (
                <a className="discover-card-btn" href={candidate.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> Visit
                </a>
              )}
            </>
          ) : isPaper ? (
            <>
              {added && newId ? (
                <button className="discover-card-btn primary" onClick={() => navigate(`/source/${newId}`)}>
                  <BookOpen size={13} /> Read now
                </button>
              ) : (
                <button
                  className={`discover-card-btn ${added ? "" : "primary"}`}
                  onClick={handleAdd}
                  disabled={adding || added}
                >
                  {added ? <Check size={13} /> : adding ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                  {added ? "Added" : adding ? "Adding…" : "Add to library"}
                </button>
              )}
              {candidate.url && (
                <a className="discover-card-btn" href={candidate.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> arXiv
                </a>
              )}
            </>
          ) : candidate.url ? (
            <a className="discover-card-btn" href={candidate.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} /> Open Library
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
