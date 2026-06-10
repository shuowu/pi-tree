import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { Source, SourceType } from "@pi-tree/shared";
import { fetchSources, fetchTags, addSourceTag, removeSourceTag, fetchJobs, type JobWithSource } from "../api";
import { Plus, Search, Tag, X, Cpu, TreePine, ArrowLeft } from "lucide-react";
import { BookCover } from "./BookCover";
import { AddBookModal } from "./AddBookModal";
import { getSourceTypeConfig, SOURCE_TYPE_CONFIGS } from "../source-types";
import "./Library.css";


/** Source type filter options for the chips */
const TYPE_FILTERS: { label: string; value: SourceType | null }[] = [
  { label: "All", value: null },
  { label: "Books", value: "book" },
];

export function Library() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);


  // Search & filter state
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState<SourceType | null>(null);



  // Tag modal state
  const [tagModalSource, setTagModalSource] = useState<Source | null>(null);
  const [newTagInput, setNewTagInput] = useState("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (query?: string, tags?: string[], type?: SourceType | null) => {
    setLoading(true);
    setError(null);
    try {
      const opts: { search?: string; tags?: string[]; type?: SourceType } = {};
      if (query) opts.search = query;
      if (tags && tags.length > 0) opts.tags = tags;
      if (type) opts.type = type;
      const hasOpts = Object.keys(opts).length > 0;
      const data = await fetchSources(hasOpts ? opts : undefined);
      setSources(data);
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

  // Load sources when search/tags/type change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(searchQuery, selectedTags, selectedType);
  }, [searchQuery, selectedTags, selectedType, load]);



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
      case "queued": return "Queued in line";
      case "parsing_file": return "Parsing ebook files";
      case "writing_markdown": return "Saving formatted markdown";
      case "generating_outline": return "AI Analysis: Creating outline & TOC";
      case "generating_summary": return "AI Analysis: Writing summaries";
      case "finished": return "Finalizing book contents";
      default: return "Processing book";
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
      load(searchQuery, selectedTags, selectedType);
    }
    prevJobsRef.current = jobs;
  }, [jobs, load, searchQuery, selectedTags, selectedType]);

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
          (searchQuery || selectedTags.length > 0 || selectedType)
            ? {
                search: searchQuery || undefined,
                tags: selectedTags.length ? selectedTags : undefined,
                type: selectedType || undefined,
              }
            : undefined
        ),
        loadTags(),
      ]);
      setSources(updatedSources);
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
          (searchQuery || selectedTags.length > 0 || selectedType)
            ? {
                search: searchQuery || undefined,
                tags: selectedTags.length ? selectedTags : undefined,
                type: selectedType || undefined,
              }
            : undefined
        ),
        loadTags(),
      ]);
      setSources(updatedSources);
      const updated = updatedSources.find((s) => s.id === sourceId);
      if (updated) setTagModalSource(updated);
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  // Determine if we're in a "no sources at all" empty state
  const isEmptyLibrary = !loading && !error && sources.length === 0 && !searchQuery && selectedTags.length === 0 && !selectedType;

  return (
    <div className="library">
      <header className="library-header">
        <div className="library-header-left">
          <button className="library-back-btn" onClick={() => navigate("/")}>
            <ArrowLeft size={16} />
          </button>
          <h1><TreePine size={24} strokeWidth={1.5} /> <span>Library</span></h1>
        </div>
        <div className="library-header-right">
          <button
            className="library-add-source-btn"
            onClick={() => setShowAddModal(true)}
            title="Add a book or news feed to your library"
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
            placeholder="Search sources and sessions..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="library-search-input"
          />
          {searchInput && (
            <button className="library-search-clear" onClick={() => setSearchInput("")}>
              <X size={14} />
            </button>
          )}
        </div>
        <div className="type-filter-chips">
          {TYPE_FILTERS.map((tf) => (
            <button
              key={tf.label}
              className={`type-chip ${selectedType === tf.value ? "active" : ""}`}
              onClick={() => setSelectedType(tf.value)}
            >
              {tf.value && (() => {
                const Icon = SOURCE_TYPE_CONFIGS[tf.value].icon;
                return <Icon size={14} />;
              })()}
              {tf.label}
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="library-tag-filters">
            {allTags.map((tag) => (
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
          <div className="jobs-panel-header" onClick={() => setShowJobs(!showJobs)}>
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
                      <div className="job-book-title">{job.sourceTitle}</div>
                      <div className="job-book-author">by {job.sourceAuthor}</div>
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
          <button onClick={() => load(searchQuery, selectedTags, selectedType)}>Retry</button>
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

      {!loading && !error && !isEmptyLibrary && (
        <div className="library-grid">
          {sources.filter(s => s.type !== 'news' && s.type !== 'router').map((source) => {
            const typeConfig = getSourceTypeConfig(source.type);
            const TypeIcon = typeConfig.icon;
            return (
              <div
                key={source.id}
                className="book-card"
                onClick={() => selectSource(source)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && selectSource(source)}
              >
                <BookCover
                  sourceId={source.id}
                  title={source.title}
                  author={source.author}
                  hasCover={source.hasCover}
                  sourceType={source.type}
                  size="sm"
                />
                <div className="book-card-info">
                  <div className="book-card-title">
                    <span className="book-card-type-icon"><TypeIcon size={14} /></span>
                    {source.title}
                  </div>
                  <div className="book-card-author">
                    {source.author}{source.year ? `, ${source.year}` : ''}
                  </div>
                  <div className="book-card-badges">

                    {source.tags?.map((tag) => (
                      <span key={tag} className="badge badge-tag">{tag}</span>
                    ))}
                    {source.hasMarkdown && (
                      <span className="badge badge-green">Converted</span>
                    )}
                    {source.hasOutline && (
                      <span className="badge badge-amber">Outline</span>
                    )}
                    {source.source === "upload" && (
                      <span className="badge badge-blue">Uploaded</span>
                    )}
                    {source.status === "failed" && (
                      <span className="badge badge-red">Failed</span>
                    )}
                    {(source.status === "pending" || source.status === "processing") && (
                      <span className="badge badge-blue animate-pulse" style={{ animation: "pulse 1.5s ease-in-out infinite" }}>
                        {source.status === "processing" ? "Processing..." : "Queued"}
                      </span>
                    )}
                  </div>
                </div>
                {/* Tag button */}
                <button
                  className="book-card-tag-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagModalSource(source);
                    setNewTagInput("");
                  }}
                  title="Manage tags"
                >
                  <Tag size={14} />
                </button>
              </div>
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
        <AddBookModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            load(searchQuery, selectedTags, selectedType);
            loadJobs();
            setShowJobs(true);
          }}
        />
      )}



    </div>
  );
}
