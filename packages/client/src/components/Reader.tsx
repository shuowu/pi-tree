import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type {
  Book,
  ChatMessage,
  BreadcrumbItem,
  TreeNodeView,
  BranchOption,
} from "@pi-books/shared";
import { startSession, resetSession, sendMessageStreaming, viewScope, streamLookup, saveGlossary, fetchGlossary, deleteNode, renameNode, processBook, fetchJobStatus, type Job } from "../api";
import { useUser } from "../UserContext";
import { ChatView } from "./ChatView";
import { WelcomeState, type SessionMode } from "./WelcomeState";
import { BookSetupState } from "./BookSetupState";
import { Sidebar } from "./Sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { DictionaryPanel, DictQuickCard, type DictEntry } from "./DictionaryPanel";
import { BookContentPanel } from "./BookContentPanel";
import { BookSettingsModal } from "./BookSettingsModal";
import { GitBranch, BookA, BookOpen, X, Settings } from "lucide-react";
import "./Reader.css";

interface ReaderProps {
  book: Book;
}

export function Reader({ book }: ReaderProps) {
  const navigate = useNavigate();
  const { userId } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [currentBook, setCurrentBook] = useState<Book>(book);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);

  useEffect(() => {
    setCurrentBook(book);
  }, [book]);

  useEffect(() => {
    if (currentBook.status === "processing" || currentBook.status === "pending") {
      fetchJobStatus(currentBook.id).then(setCurrentJob);
    }
  }, [currentBook.status, currentBook.id]);

  useEffect(() => {
    if (currentBook.status !== "processing" && currentBook.status !== "pending") return;

    const timer = setInterval(async () => {
      try {
        const job = await fetchJobStatus(currentBook.id);
        if (job) {
          setCurrentJob(job);
          if (job.status === "completed") {
            clearInterval(timer);
            const bookRes = await fetch(`/api/library/books/${currentBook.id}`);
            if (bookRes.ok) {
              const updatedBook = await bookRes.json();
              setCurrentBook(updatedBook);
              window.location.reload();
            }
          } else if (job.status === "failed") {
            clearInterval(timer);
            const bookRes = await fetch(`/api/library/books/${currentBook.id}`);
            if (bookRes.ok) {
              const updatedBook = await bookRes.json();
              setCurrentBook(updatedBook);
            }
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [currentBook.status, currentBook.id]);

  const handleProcessBook = async () => {
    try {
      await processBook(currentBook.id);
      setCurrentBook((prev) => ({ ...prev, status: "processing" }));
      const job = await fetchJobStatus(currentBook.id);
      if (job) setCurrentJob(job);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReprocessBook = useCallback(async () => {
    if (!confirm("Are you sure you want to re-process this book? This will regenerate the outline, table of contents, and summary. It runs in the background and takes 30-60 seconds.")) return;
    try {
      await processBook(currentBook.id);
      setCurrentBook((prev) => ({ ...prev, status: "processing" }));
      const job = await fetchJobStatus(currentBook.id);
      if (job) setCurrentJob(job);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }, [currentBook.id]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [tree, setTree] = useState<TreeNodeView | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"dict" | "book">("dict");
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showBookSettings, setShowBookSettings] = useState(false);
  const [quickLookupId, setQuickLookupId] = useState<string | null>(null);
  const initialized = useRef(false);
  // Track the last viewNodeId we set programmatically, so we can detect
  // browser-initiated changes (back/forward) vs our own updates.
  const lastViewNodeIdRef = useRef<string | null>(null);

  // Derive viewNodeId from URL search params — single source of truth
  const viewNodeId = searchParams.get("node") ?? null;

  /** Update the URL ?node= param */
  const updateUrl = useCallback(
    (nodeId: string | null, replace: boolean) => {
      lastViewNodeIdRef.current = nodeId;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (nodeId) {
            next.set("node", nodeId);
          } else {
            next.delete("node");
          }
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  /** Apply session data to React state only (no URL update) */
  const applySessionData = useCallback(
    (state: {
      messages: ChatMessage[];
      breadcrumb: BreadcrumbItem[];
      tree: TreeNodeView;
      branches: BranchOption[];
    }) => {
      setMessages(state.messages);
      setBreadcrumb(state.breadcrumb);
      setTree(state.tree);
      setBranches(state.branches);
    },
    [],
  );

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!userId) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setStreamingContent("");

      await sendMessageStreaming(userId, book.id, message, lastViewNodeIdRef.current, {
        onToken: (token) => {
          setStreamingContent((prev) => (prev ?? "") + token);
        },
        onCompaction: (compacting) => {
          setIsCompacting(compacting);
        },
        onTreeUpdate: (updatedTree) => {
          setTree(updatedTree);
        },
        onDone: (result) => {
          setStreamingContent(null);
          setIsLoading(false);
          setIsCompacting(false);
          applySessionData(result);
          // Server may have changed the active node — replace (not push)
          updateUrl(result.viewNodeId, true);
        },
        onError: (err) => {
          setStreamingContent(null);
          setIsLoading(false);
          setIsCompacting(false);
          const errorMsg: ChatMessage = {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `⚠️ Error: ${err.message}`,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      });
    },
    [userId, book.id, applySessionData, updateUrl],
  );

  // ---------------------------------------------------------------------------
  // Dictionary
  // ---------------------------------------------------------------------------

  const handleDefine = useCallback(
    (term: string, context?: string) => {
      if (!userId) return;

      const entryId = `dict-${Date.now()}`;
      const newEntry: DictEntry = {
        id: entryId,
        term,
        definition: "",
        streaming: true,
        timestamp: new Date().toISOString(),
      };

      setDictEntries((prev) => [...prev, newEntry]);
      setRightPanelOpen(true);

      // If on Book tab, show floating mini-card instead of switching tabs
      if (rightTab === "book") {
        setQuickLookupId(entryId);
      } else {
        setRightTab("dict");
      }

      streamLookup(userId, book.id, term, (token) => {
        setDictEntries((prev) =>
          prev.map((e) =>
            e.id === entryId ? { ...e, definition: e.definition + token } : e,
          ),
        );
      }, context)
        .then((fullDef) => {
          setDictEntries((prev) =>
            prev.map((e) =>
              e.id === entryId
                ? { ...e, definition: fullDef || e.definition, streaming: false }
                : e,
            ),
          );
          // Auto-save to glossary
          if (userId) {
            saveGlossary(userId, book.id, term, fullDef).catch(() => {});
          }
        })
        .catch(() => {
          setDictEntries((prev) =>
            prev.map((e) =>
              e.id === entryId
                ? { ...e, definition: "Lookup failed.", streaming: false }
                : e,
            ),
          );
        });
    },
    [userId, book.id, rightTab],
  );


  const handleDictRemove = useCallback((id: string) => {
    setDictEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const isMobile = useCallback(() => window.innerWidth <= 768, []);

  const handleNavigate = useCallback(
    async (nodeId: string) => {
      if (!userId) return;

      // Auto-close sidebar on mobile after navigating
      if (isMobile()) {
        setSidebarOpen(false);
      }

      setIsLoading(true);
      try {
        // Empty nodeId = navigate to root
        const state = await viewScope(userId, book.id, nodeId || null);
        applySessionData(state);
        updateUrl(state.viewNodeId, false); // push history entry
      } catch (err) {
        console.error("Navigate failed:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, book.id, applySessionData, updateUrl, isMobile],
  );

  const handleBackToRoot = useCallback(async () => {
    if (!userId) return;

    setIsLoading(true);
    try {
      const state = await viewScope(userId, book.id, null);
      applySessionData(state);
      updateUrl(state.viewNodeId, false); // push history entry
    } catch (err) {
      console.error("Back to root failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, book.id, applySessionData, updateUrl]);

  const goBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Drag-to-resize sidebar
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      document.body.classList.add("is-resizing-panels");

      const onMouseMove = (ev: MouseEvent) => {
        const currentWidth = startWidth + ev.clientX - startX;
        
        // Ensure central layout gets at least 360px
        const activeRightWidth = rightPanelOpen ? rightSidebarWidth : 0;
        const maxAllowed = Math.max(200, window.innerWidth - activeRightWidth - 360);

        if (currentWidth < 140) {
          // Visual cue for collapse: set width to 0
          setSidebarWidth(0);
        } else {
          const boundedWidth = Math.max(200, Math.min(maxAllowed, currentWidth));
          setSidebarWidth(boundedWidth);
        }
      };

      const onMouseUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.classList.remove("is-resizing-panels");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        const finalWidth = startWidth + ev.clientX - startX;
        if (finalWidth < 140) {
          setSidebarOpen(false);
          setSidebarWidth(300); // Reset for next open
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth, rightPanelOpen, rightSidebarWidth],
  );

  // Handle mode selection from welcome screen
  const handleSelectMode = useCallback(
    (mode: SessionMode) => {
      setShowWelcome(false);
      if (mode === "reading") {
        handleSendMessage(
          `Let's start reading "${book.title}" by ${book.author}. Give me a chapter briefing to begin.`,
        );
      } else {
        handleSendMessage(
          `I'd like to explore "${book.title}" by ${book.author} through Q&A. I'll ask questions about the book — its themes, arguments, key passages, and ideas. Start by briefly introducing the book's main thesis in 2-3 sentences, then let me lead with questions.`,
        );
      }
    },
    [book, handleSendMessage],
  );

  // On mount: load existing session, restoring viewNodeId from URL if present
  useEffect(() => {
    if (initialized.current) return;
    if (!userId) return;
    initialized.current = true;

    const initialNodeId = searchParams.get("node") ?? null;
    lastViewNodeIdRef.current = initialNodeId;

    (async () => {
      setIsLoading(true);
      try {
        const state = await startSession(userId, book.id);

        // Load persisted glossary entries from DB
        try {
          const saved = await fetchGlossary(userId, book.id);
          if (saved.length > 0) {
            setDictEntries(saved.map((e) => ({
              id: `saved-${e.id}`,
              term: e.term,
              definition: e.definition ?? "",
              streaming: false,
              timestamp: e.createdAt,
            })));
          }
        } catch {
          // Glossary load failed — non-critical, continue
        }

        if (state.messages.length > 0) {
          // Existing session — restore it
          if (initialNodeId) {
            try {
              const scopedState = await viewScope(userId, book.id, initialNodeId);
              applySessionData(scopedState);
              updateUrl(scopedState.viewNodeId, true);
            } catch {
              // Node not found — fall back to server default
              applySessionData(state);
              updateUrl(state.viewNodeId, true);
            }
          } else {
            applySessionData(state);
            updateUrl(state.viewNodeId, true);
          }
          setIsLoading(false);
        } else {
          // Fresh session — show welcome screen instead of auto-firing
          setIsLoading(false);
          setShowWelcome(true);
        }
      } catch {
        setIsLoading(false);
      }
    })();
  }, [userId, book, applySessionData, updateUrl, searchParams]);

  // React to browser back/forward: when viewNodeId changes from a popstate
  // (not from our own programmatic update), re-fetch the node data.
  useEffect(() => {
    if (!initialized.current) return;
    if (!userId) return;
    if (viewNodeId === lastViewNodeIdRef.current) return;

    // Browser navigation happened — sync state
    lastViewNodeIdRef.current = viewNodeId;
    (async () => {
      setIsLoading(true);
      try {
        const state = await viewScope(userId, book.id, viewNodeId);
        applySessionData(state);
      } catch (err) {
        console.error("Browser nav restore failed:", err);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [viewNodeId, userId, book.id, applySessionData]);

  // Escape key: go back one scope level
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && viewNodeId) {
        e.preventDefault();
        handleBackToRoot();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [viewNodeId, handleBackToRoot]);

  // Right sidebar drag resize
  const handleRightResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = rightSidebarWidth;
      document.body.classList.add("is-resizing-panels");

      const onMouseMove = (ev: MouseEvent) => {
        const currentWidth = startWidth - (ev.clientX - startX);

        // Ensure central layout gets at least 360px
        const activeLeftWidth = sidebarOpen ? sidebarWidth : 0;
        const maxAllowed = Math.max(200, window.innerWidth - activeLeftWidth - 360);

        if (currentWidth < 140) {
          setRightSidebarWidth(0);
        } else {
          const boundedWidth = Math.max(200, Math.min(maxAllowed, currentWidth));
          setRightSidebarWidth(boundedWidth);
        }
      };

      const onMouseUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.classList.remove("is-resizing-panels");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        const finalWidth = startWidth - (ev.clientX - startX);
        if (finalWidth < 140) {
          setRightPanelOpen(false);
          setRightSidebarWidth(320); // Reset for next open
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [rightSidebarWidth, sidebarOpen, sidebarWidth],
  );

  // Panel toggle handlers (VS Code-style: click same = close, click different = switch)
  const toggleNavigator = useCallback(() => {
    setSidebarOpen((v) => {
      const nextVal = !v;
      if (nextVal && window.innerWidth <= 1024) {
        setRightPanelOpen(false);
      }
      return nextVal;
    });
  }, []);

  const toggleDict = useCallback(() => {
    if (rightPanelOpen && rightTab === "dict") {
      setRightPanelOpen(false);
    } else {
      setRightPanelOpen(true);
      setRightTab("dict");
      if (window.innerWidth <= 1024) {
        setSidebarOpen(false);
      }
    }
  }, [rightPanelOpen, rightTab]);

  const toggleBook = useCallback(() => {
    if (rightPanelOpen && rightTab === "book") {
      setRightPanelOpen(false);
    } else {
      setRightPanelOpen(true);
      setRightTab("book");
      if (window.innerWidth <= 1024) {
        setSidebarOpen(false);
      }
    }
  }, [rightPanelOpen, rightTab]);

  const handleDeleteNode = useCallback(async (nodeId: string) => {
    if (!userId) return;
    try {
      const state = await deleteNode(userId, book.id, nodeId, viewNodeId);
      applySessionData(state);
      updateUrl(state.viewNodeId, true);
    } catch (err) {
      console.error("Delete node failed:", err);
    }
  }, [userId, book.id, viewNodeId, applySessionData, updateUrl]);

  const handleRenameNode = useCallback(async (nodeId: string, newLabel: string) => {
    if (!userId) return;
    try {
      const state = await renameNode(userId, book.id, nodeId, newLabel, viewNodeId);
      applySessionData(state);
    } catch (err) {
      console.error("Rename node failed:", err);
    }
  }, [userId, book.id, viewNodeId, applySessionData]);

  const handleResetSession = useCallback(async () => {
    if (!userId) return;
    if (!confirm("Clear this session? All conversation history will be lost.")) return;
    try {
      await resetSession(userId, book.id);
      // Full reload to get a clean slate
      window.location.href = `/book/${book.id}`;
    } catch (err) {
      console.error("Reset failed:", err);
    }
  }, [userId, book.id]);

  const panelToggles = [
    { id: "nav", icon: <GitBranch size={16} />, label: "Session Tree", active: sidebarOpen, onClick: toggleNavigator },
    { id: "dict", icon: <BookA size={16} />, label: "Dictionary", active: rightPanelOpen && rightTab === "dict", onClick: toggleDict },
    { id: "book", icon: <BookOpen size={16} />, label: "Book", active: rightPanelOpen && rightTab === "book", onClick: toggleBook },
    { id: "settings", icon: <Settings size={16} />, label: "Book Settings", active: showBookSettings, onClick: () => setShowBookSettings(true) },
  ];

  const cssVars = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--right-sidebar-width": `${rightSidebarWidth}px`,
  } as React.CSSProperties;

  return (
    <div
      className={`reader ${sidebarOpen ? "sidebar-open" : ""} ${rightPanelOpen ? "dict-open" : ""}`}
      style={cssVars}
    >
      {/* Mobile overlay backdrop */}
      <div
        className={`reader-overlay ${sidebarOpen || rightPanelOpen ? "visible" : ""}`}
        onClick={() => { setSidebarOpen(false); setRightPanelOpen(false); }}
      />
      <Sidebar
        bookId={book.id}
        tree={tree}
        viewNodeId={viewNodeId}
        onNavigate={handleNavigate}
        onDeleteNode={handleDeleteNode}
        onRenameNode={handleRenameNode}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && (
        <div className="resize-handle" onMouseDown={handleResizeStart} />
      )}
      <main className="reader-main">
        <Breadcrumb
          items={breadcrumb}
          onNavigate={handleNavigate}
          onHome={goBack}
          bookTitle={book.title}
          isScoped={viewNodeId !== null}
          panelToggles={panelToggles}
        />
        {currentBook.status === "processing" || currentBook.status === "pending" || (showWelcome && currentBook.hasMarkdown && !currentBook.hasOutline) ? (
          <BookSetupState
            book={currentBook}
            job={currentJob}
            onSkipToChat={() => handleSelectMode('qa')}
            onProcess={handleProcessBook}
          />
        ) : showWelcome ? (
          <WelcomeState
            book={currentBook}
            onSelectMode={handleSelectMode}
            isLoading={isLoading}
          />
        ) : (
          <ChatView
            messages={messages}
            isLoading={isLoading}
            isCompacting={isCompacting}
            streamingContent={streamingContent}
            onSendMessage={handleSendMessage}
            branches={branches}
            onDrillDown={handleNavigate}
            isScoped={viewNodeId !== null}
            bookId={book.id}
            onDefine={handleDefine}
          />
        )}
      </main>

      {/* Right sidebar: always rendered, hidden via CSS to preserve nav state */}
      <div className={`resize-handle-right ${rightPanelOpen ? "" : "hidden"}`} onMouseDown={handleRightResizeStart} />
      <aside className={`right-sidebar ${rightPanelOpen ? "" : "hidden"}`}>
        <div className="right-sidebar-header">
          <div className="right-sidebar-tabs">
            <button
              className={`right-sidebar-tab ${rightTab === "dict" ? "active" : ""}`}
              onClick={() => { setRightTab("dict"); setQuickLookupId(null); }}
            >
              Dictionary
              {dictEntries.length > 0 && (
                <span className="right-sidebar-count">{dictEntries.length}</span>
              )}
            </button>
            <button
              className={`right-sidebar-tab ${rightTab === "book" ? "active" : ""}`}
              onClick={() => setRightTab("book")}
            >
              Book
            </button>
          </div>
          <button
            className="right-sidebar-close"
            onClick={() => setRightPanelOpen(false)}
            title="Close panel"
          >
            <X size={14} />
          </button>
        </div>
        <div className="right-sidebar-body">
          <div style={{ display: rightTab === "dict" ? "contents" : "none" }}>
            <DictionaryPanel entries={dictEntries} onRemove={handleDictRemove} />
          </div>
          <div style={{ display: rightTab === "book" ? "contents" : "none" }}>
            <BookContentPanel bookId={book.id} onDefine={handleDefine} />
            {quickLookupId && (() => {
              const entry = dictEntries.find((e) => e.id === quickLookupId);
              if (!entry) return null;
              return (
                <DictQuickCard
                  entry={entry}
                  onDismiss={() => setQuickLookupId(null)}
                  onGoToDict={() => { setRightTab("dict"); setQuickLookupId(null); }}
                />
              );
            })()}
          </div>
        </div>
      </aside>

      {showBookSettings && (
        <BookSettingsModal
          book={currentBook}
          onClose={() => setShowBookSettings(false)}
          onReprocess={handleReprocessBook}
          onClearSession={handleResetSession}
        />
      )}
    </div>
  );
}
