import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import type { Book } from "@pi-tree/shared";
import { fetchBooks, fetchTags, addBookTag, removeBookTag, fetchJobs, type JobWithBook } from "../api";
import { useUser } from "../UserContext";
import { BookOpen, LogOut, Plus, Search, Tag, X, Settings, Cpu } from "lucide-react";
import { BookCover } from "./BookCover";
import { AddBookModal } from "./AddBookModal";
import { SettingsModal } from "./SettingsModal";
import "./Library.css";

export function Library() {
  const navigate = useNavigate();
  const { displayName, clearUser } = useUser();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Search & filter state
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Tag modal state
  const [tagModalBook, setTagModalBook] = useState<Book | null>(null);
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
      const opts = (query || (tags && tags.length > 0))
        ? { search: query || undefined, tags: tags?.length ? tags : undefined }
        : undefined;
      const data = await fetchBooks(opts);
      setBooks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load books");
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

  // Load books when search/tags change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(searchQuery, selectedTags);
  }, [searchQuery, selectedTags, load]);

  // Load tags on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTags();
  }, [loadTags]);

  // Background jobs state
  const [jobs, setJobs] = useState<JobWithBook[]>([]);
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

  // If a job completes/fails, reload books to reflect new statuses/metadata
  const prevJobsRef = useRef<JobWithBook[]>([]);
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
    if (!tagModalBook) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTagModalBook(null);
        setNewTagInput("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tagModalBook]);

  const selectBook = (book: Book) => {
    navigate(`/book/${book.id}`);
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const handleAddTag = async (bookId: string) => {
    const tag = newTagInput.toLowerCase().trim();
    if (!tag) return;
    try {
      await addBookTag(bookId, tag);
      setNewTagInput("");
      // Refresh data
      const [updatedBooks] = await Promise.all([
        fetchBooks(
          (searchQuery || selectedTags.length > 0)
            ? { search: searchQuery || undefined, tags: selectedTags.length ? selectedTags : undefined }
            : undefined
        ),
        loadTags(),
      ]);
      setBooks(updatedBooks);
      // Update the modal book reference
      const updated = updatedBooks.find((b) => b.id === bookId);
      if (updated) setTagModalBook(updated);
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };

  const handleRemoveTag = async (bookId: string, tag: string) => {
    try {
      await removeBookTag(bookId, tag);
      const [updatedBooks] = await Promise.all([
        fetchBooks(
          (searchQuery || selectedTags.length > 0)
            ? { search: searchQuery || undefined, tags: selectedTags.length ? selectedTags : undefined }
            : undefined
        ),
        loadTags(),
      ]);
      setBooks(updatedBooks);
      const updated = updatedBooks.find((b) => b.id === bookId);
      if (updated) setTagModalBook(updated);
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };

  return (
    <div className="library">
      <header className="library-header">
        <div className="library-header-left">
          <h1><BookOpen size={24} strokeWidth={1.5} /> <span>Pi Reader</span></h1>
        </div>
        <div className="library-header-right">
          <button
            className="library-config-btn"
            onClick={() => setShowSettingsModal(true)}
            title="Global AI Settings"
          >
            <Settings size={16} strokeWidth={2} />
            Settings
          </button>
          <button
            className="library-add-btn"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={16} strokeWidth={2} />
            Add Book
          </button>
          {displayName && (
            <div className="library-user-menu">
              <button className="library-user-pill" onClick={clearUser} title="Switch user">
                <span className="library-user-avatar">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                {displayName}
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="library-filters">
        <div className="library-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search books..."
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
                      <div className="job-book-title">{job.bookTitle}</div>
                      <div className="job-book-author">by {job.bookAuthor}</div>
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

      {!loading && !error && (
        <div className="library-grid">
          {books.map((book) => (
            <div
              key={book.id}
              className="book-card"
              onClick={() => selectBook(book)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && selectBook(book)}
            >
              <BookCover
                bookId={book.id}
                title={book.title}
                author={book.author}
                hasCover={book.hasCover}
                size="md"
              />
              <div className="book-card-info">
                <div className="book-card-title">{book.title}</div>
                <div className="book-card-author">
                  {book.author}, {book.year}
                </div>
                <div className="book-card-badges">
                  {book.tags?.map((tag) => (
                    <span key={tag} className="badge badge-tag">{tag}</span>
                  ))}
                  {book.hasMarkdown && (
                    <span className="badge badge-green">Converted</span>
                  )}
                  {book.hasOutline && (
                    <span className="badge badge-amber">Outline</span>
                  )}
                  {book.source === "upload" && (
                    <span className="badge badge-blue">Uploaded</span>
                  )}
                  {book.status === "failed" && (
                    <span className="badge badge-red">Failed</span>
                  )}
                  {(book.status === "pending" || book.status === "processing") && (
                    <span className="badge badge-blue animate-pulse" style={{ animation: "pulse 1.5s ease-in-out infinite" }}>
                      {book.status === "processing" ? "Processing..." : "Queued"}
                    </span>
                  )}
                </div>
              </div>
              {/* Tag button */}
              <button
                className="book-card-tag-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setTagModalBook(book);
                  setNewTagInput("");
                }}
                title="Manage tags"
              >
                <Tag size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tag management modal */}
      {tagModalBook && (
        <div
          className="tag-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setTagModalBook(null);
              setNewTagInput("");
            }
          }}
        >
          <div className="tag-modal">
            <button
              className="tag-modal-close"
              onClick={() => { setTagModalBook(null); setNewTagInput(""); }}
            >
              <X size={16} />
            </button>
            <h3 className="tag-modal-title">
              <Tag size={16} />
              Tags for {tagModalBook.title}
            </h3>
            {tagModalBook.tags && tagModalBook.tags.length > 0 ? (
              <div className="tag-modal-tags">
                {tagModalBook.tags.map((tag) => (
                  <span key={tag} className="tag-modal-tag">
                    {tag}
                    <button onClick={() => handleRemoveTag(tagModalBook.id, tag)}>
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
                    handleAddTag(tagModalBook.id);
                  }
                }}
                autoFocus
              />
              <button
                className="tag-modal-add-btn"
                onClick={() => handleAddTag(tagModalBook.id)}
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
            load(searchQuery, selectedTags);
            loadJobs();
            setShowJobs(true);
          }}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
