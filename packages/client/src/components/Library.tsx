import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { Source } from "@pi-tree/shared";
import { fetchSources, fetchTags, addSourceTag, removeSourceTag, fetchJobs, processSource, type JobWithSource } from "../api";
import { Plus, Search, Tag, X, Cpu, GitFork, ArrowLeft, LayoutGrid, RefreshCw } from "lucide-react";
import { SourceCover } from "./SourceCover";
import { AddSourceModal } from "./AddSourceModal";
import { getSourceTypeConfig, SOURCE_TYPE_CONFIGS } from "../source-types";
import { SourceCard } from "./SourceCard";
import appConfig from "../pi-tree.config";
import "./Library.css";

export function Library() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [updateAllRunning, setUpdateAllRunning] = useState(false);


  // Search & filter state
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Build tabs from registered source types (plugin-driven) + compute counts
  const typeTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allSources) {
      counts[s.type] = (counts[s.type] || 0) + 1;
    }
    return Object.entries(SOURCE_TYPE_CONFIGS).map(([key, cfg]) => ({
      key,
      label: cfg.label,
      icon: cfg.icon,
      count: counts[key] || 0,
    }));
  }, [allSources]);

  // Filter sources by active tab
  const sources = useMemo(() => {
    if (!activeTab) return allSources;
    return allSources.filter(s => s.type === activeTab);
  }, [allSources, activeTab]);

  // Tags relevant to the active tab (or all tags when on "All")
  const visibleTags = useMemo(() => {
    const pool = activeTab ? allSources.filter(s => s.type === activeTab) : allSources;
    const tagSet = new Set<string>();
    for (const s of pool) {
      s.tags?.forEach(t => tagSet.add(t));
    }
    return allTags.filter(t => tagSet.has(t));
  }, [allSources, allTags, activeTab]);

  // Clear selected tags that become invisible when switching tabs
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTags(prev => {
      const filtered = prev.filter(t => visibleTags.includes(t));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [visibleTags]);



  // Tag modal state
  const [tagModalSource, setTagModalSource] = useState<Source | null>(null);
  const [newTagInput, setNewTagInput] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (query?: string, tags?: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const opts: { search?: string; tags?: string[] } = {};
      if (query) opts.search = query;
      if (tags && tags.length > 0) opts.tags = tags;
      const hasOpts = Object.keys(opts).length > 0;
      const data = await fetchSources(hasOpts ? opts : undefined);
      setAllSources(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, []);



  const loadTags = useCallback(async () => {
    try {
      const data = await fetchTags();
      setAllTags(data);
    } catch {
      // Non-critical — fail silently
    }
  }, []);

  // Load sources when search/tags change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(searchQuery, selectedTags);
  }, [searchQuery, selectedTags, load]);



  // Load tags on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTags();
  }, [loadTags]);

  // Auto-focus search when navigating with ?focus=search
  useEffect(() => {
    if (searchParams.get("focus") === "search") {
      searchInputRef.current?.focus();
    }
  }, [searchParams]);

  // Background jobs state
  const [jobs, setJobs] = useState<JobWithSource[]>([]);
  const [showJobs, setShowJobs] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchJobs();
      setJobs(data);
      // Auto-expand jobs list if there are active jobs
      const hasActive = data.some(j => j.status === "pending" || j.status === "processing");
      if (hasActive) {
        setShowJobs(true);
      }
    } catch (err) {
      console.error("Failed to load background jobs:", err);
    }
  }, []);

  const getStepLabel = (step?: string) => {
    switch (step) {
      case "queued": return "Queued";
      case "converting": return "Converting to markdown";
      case "analyzing": return "AI analyzing: outline & summary";
      case "processing": return "Processing…";
      case "done": return "Complete";
      default: return step ? `Processing: ${step}` : "Processing…";
    }
  };

  // Load jobs on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadJobs();
  }, [loadJobs]);

  // Polling loop for active jobs
  useEffect(() => {
    const hasActiveJobs = jobs.some(j => j.status === "pending" || j.status === "processing");
    if (!hasActiveJobs) return;

    const timer = setInterval(() => {
      loadJobs();
    }, 3000);

    return () => clearInterval(timer);
  }, [jobs, loadJobs]);

  // If a job completes/fails, reload sources to reflect new statuses/metadata
  const prevJobsRef = useRef<JobWithSource[]>([]);
  useEffect(() => {
    const statusChanged = jobs.some(job => {
      const prev = prevJobsRef.current.find(p => p.id === job.id);
      return prev && prev.status !== job.status;
    });

    const newJobsAdded = jobs.length > prevJobsRef.current.length;

    if (statusChanged || newJobsAdded) {
      load(searchQuery, selectedTags);
    }
    prevJobsRef.current = jobs;
  }, [jobs, load, searchQuery, selectedTags]);

  // Escape key closes tag modal
  useEffect(() => {
    if (!tagModalSource) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTagModalSource(null);
        setNewTagInput("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tagModalSource]);

  const selectSource = (source: Source) => {
    navigate(`/source/${source.id}`);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleAddTag = async (sourceId: string) => {
    const tag = newTagInput.toLowerCase().trim();
    if (!tag) return;
    try {
      await addSourceTag(sourceId, tag);
      setNewTagInput("");
      // Refresh data
      const [updatedSources] = await Promise.all([
        fetchSources(
          (searchQuery || selectedTags.length > 0)
            ? {
                search: searchQuery || undefined,
                tags: selectedTags.length ? selectedTags : undefined,
              }
            : undefined
        ),
        loadTags(),
      ]);
      setAllSources(updatedSources);
      // Update the modal source reference
      const updated = updatedSources.find((s) => s.id === sourceId);
      if (updated) setTagModalSource(updated);
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };

  const handleRemoveTag = async (sourceId: string, tag: string) => {
    try {
      await removeSourceTag(sourceId, tag);
      const [updatedSources] = await Promise.all([
        fetchSources(
          (searchQuery || selectedTags.length > 0)
            ? {
                search: searchQuery || undefined,
                tags: selectedTags.length ? selectedTags : undefined,
              }
            : undefined
        ),
        loadTags(),
      ]);
      setAllSources(updatedSources);
      const updated = updatedSources.find((s) => s.id === sourceId);
      if (updated) setTagModalSource(updated);
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  // Determine if we're in a "no sources at all" empty state
  const isEmptyLibrary = !loading && !error && allSources.length === 0 && !searchQuery && selectedTags.length === 0;

  return (
    <div className="library">
      <header className="library-header">
        <div className="library-header-left">
          <button className="library-back-btn" onClick={() => navigate("/")}>
            <ArrowLeft size={16} />
          </button>
          <h1><GitFork size={24} strokeWidth={1.5} /> <span>Library</span></h1>
        </div>
        <div className="library-header-right">
          <a
            className="library-github-link"
            href="https://github.com/shuowu/pi-tree"
            target="_blank"
            rel="noopener noreferrer"
            title="View on GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
          {allSources.length > 0 && (
            <button
              className="library-update-all-btn"
              disabled={updateAllRunning}
              onClick={async () => {
                const ok = window.confirm(
                  "Update all sources? This will generate missing analysis (e.g. concepts) for all sources."
                );
                if (!ok) return;
                setUpdateAllRunning(true);
                try {
                  for (const s of allSources) {
                    try {
                      await processSource(s.id);
                    } catch (err) {
                      console.error(`Failed to update source ${s.id}:`, err);
                    }
                  }
                  loadJobs();
                  setShowJobs(true);
                } finally {
                  setUpdateAllRunning(false);
                }
              }}
              title="Update analysis for all sources"
            >
              <RefreshCw size={14} className={updateAllRunning ? "animate-pulse" : ""} />
              {updateAllRunning ? "Updating…" : "Update All"}
            </button>
          )}
          <button
            className="library-add-source-btn"
            onClick={() => setShowAddModal(true)}
            title="Add a new source to your library"
          >
            <Plus size={16} strokeWidth={2} />
            Add Source
          </button>
        </div>
      </header>



      <div className="library-filters">
        <div className="library-search">
          <Search size={16} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search sources..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="library-search-input"
          />
          {searchInput && (
            <button className="library-search-clear" onClick={() => setSearchInput("")} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="library-tabs" role="tablist">
          <button
            className={`library-tab ${activeTab === null ? "active" : ""}`}
            onClick={() => setActiveTab(null)}
            role="tab"
            aria-selected={activeTab === null}
          >
            <LayoutGrid size={15} />
            <span>All</span>
            <span className="library-tab-count">{allSources.length}</span>
          </button>
          {typeTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                className={`library-tab ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
                role="tab"
                aria-selected={activeTab === tab.key}
              >
                <Icon size={15} />
                <span>{tab.label}s</span>
                <span className="library-tab-count">{tab.count}</span>
              </button>
            );
          })}
        </div>
        {visibleTags.length > 0 && (
          <div className="library-tag-filters">
            {visibleTags.map((tag) => (
              <button
                key={tag}
                className={`tag-filter-chip ${selectedTags.includes(tag) ? "active" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                <Tag size={12} />
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Background jobs tracker */}
      {jobs.length > 0 && (
        <div className="library-jobs-panel">
          <div className="jobs-panel-header" role="button" tabIndex={0} aria-label="Toggle background tasks" onClick={() => setShowJobs(!showJobs)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowJobs(!showJobs); } }}>
            <div className="jobs-panel-title">
              <Cpu size={16} className={jobs.some(j => j.status === 'processing') ? 'animate-pulse' : ''} />
              <span>Background Tasks ({jobs.filter(j => j.status === 'pending' || j.status === 'processing').length} active)</span>
            </div>
            <button className="jobs-panel-toggle-btn">
              {showJobs ? "Hide" : "Show"}
            </button>
          </div>
          
          {showJobs && (
            <div className="jobs-list">
              {jobs.map((job) => {
                const isActive = job.status === "pending" || job.status === "processing";
                return (
                  <div key={job.id} className={`job-item ${job.status}`}>
                    <div className="job-info">
                      <div className="job-source-title">{job.sourceTitle}</div>
                      <div className="job-source-author">by {job.sourceAuthor}</div>
                      <div className="job-step">{getStepLabel(job.step)}</div>
                    </div>
                    <div className="job-progress-section">
                      {isActive && (
                        <>
                          <div className="job-progress-bar-container">
                            <div 
                              className="job-progress-bar-fill" 
                              style={{ width: `${job.progress}%` }}
                            />
                          </div>
                          <div className="job-percentage">{job.progress}%</div>
                        </>
                      )}
                      {!isActive && (
                        <span className={`job-status-badge ${job.status}`}>
                          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                        </span>
                      )}
                      {job.error && (
                        <div className="job-error-msg" title={job.error}>
                          Error: {job.error}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="library-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-cover" />
              <div className="skeleton-info">
                <div className="skeleton-title" />
                <div className="skeleton-author" />
                <div className="skeleton-badges">
                  <div className="skeleton-badge" />
                  <div className="skeleton-badge" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="library-error">
          <p>{error}</p>
          <button onClick={() => load(searchQuery, selectedTags)}>Retry</button>
        </div>
      )}

      {isEmptyLibrary && (
        <div className="library-empty-state">
          <p>No sources yet</p>
          <button
            className="library-empty-action-btn primary"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} />
            Add Source
          </button>
        </div>
      )}

      {/* Per-type empty state when tab is selected but no matching sources */}
      {!loading && !error && !isEmptyLibrary && sources.length === 0 && activeTab && (() => {
        const tabConfig = getSourceTypeConfig(activeTab);
        const TabIcon = tabConfig.icon;
        return (
          <div className="library-empty-state">
            <TabIcon size={32} strokeWidth={1.5} />
            <p>No {tabConfig.label.toLowerCase()}s yet</p>
            {tabConfig.addSource && (
              <button
                className="library-empty-action-btn primary"
                onClick={() => setShowAddModal(true)}
              >
                <Plus size={16} />
                Add {tabConfig.label}
              </button>
            )}
          </div>
        );
      })()}

      {!loading && !error && !isEmptyLibrary && sources.length > 0 && (
        <div className="library-grid">
          {sources.map((source) => {
            const CustomCard = appConfig.sourceCards[source.type];
            const handleCardClick = () => selectSource(source);
            const handleTagClick = () => {
              setTagModalSource(source);
              setNewTagInput("");
            };
            const renderCover = (size: "sm" | "md" | "lg" = "sm") => (
              <SourceCover
                sourceId={source.id}
                title={source.title}
                author={source.author}
                hasCover={source.hasCover}
                sourceType={source.type}
                size={size}
              />
            );
            const handleUpdateSource = async () => {
              try {
                await processSource(source.id);
                loadJobs();
                setShowJobs(true);
              } catch (err) {
                console.error(`Failed to update source ${source.id}:`, err);
              }
            };
            const handleReprocessSource = async () => {
              try {
                await processSource(source.id, { force: true });
                loadJobs();
                setShowJobs(true);
              } catch (err) {
                console.error(`Failed to reprocess source ${source.id}:`, err);
              }
            };

            if (CustomCard) {
              return (
                <CustomCard
                  key={source.id}
                  source={source}
                  onClick={handleCardClick}
                  onTagClick={handleTagClick}
                  renderCover={renderCover}
                  onUpdateSource={handleUpdateSource}
                  onReprocessSource={handleReprocessSource}
                />
              );
            }

            return (
              <SourceCard
                key={source.id}
                source={source}
                onClick={handleCardClick}
                onTagClick={handleTagClick}
                renderCover={renderCover}
                onUpdateSource={handleUpdateSource}
                onReprocessSource={handleReprocessSource}
              />
            );
          })}
        </div>
      )}

      {/* Tag management modal */}
      {tagModalSource && (
        <div
          className="tag-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setTagModalSource(null);
              setNewTagInput("");
            }
          }}
        >
          <div className="tag-modal">
            <button
              className="tag-modal-close"
              onClick={() => { setTagModalSource(null); setNewTagInput(""); }}
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <h3 className="tag-modal-title">
              <Tag size={16} />
              Tags for {tagModalSource.title}
            </h3>
            {tagModalSource.tags && tagModalSource.tags.length > 0 ? (
              <div className="tag-modal-tags">
                {tagModalSource.tags.map((tag) => (
                  <span key={tag} className="tag-modal-tag">
                    {tag}
                    <button onClick={() => handleRemoveTag(tagModalSource.id, tag)}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="tag-modal-empty">No tags yet</p>
            )}
            <div className="tag-modal-input-row">
              <input
                type="text"
                placeholder="Type a tag and press Enter..."
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag(tagModalSource.id);
                  }
                }}
                autoFocus
              />
              <button
                className="tag-modal-add-btn"
                onClick={() => handleAddTag(tagModalSource.id)}
                disabled={!newTagInput.trim()}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddSourceModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            load(searchQuery, selectedTags);
            loadJobs();
            setShowJobs(true);
          }}
        />
      )}



    </div>
  );
}
