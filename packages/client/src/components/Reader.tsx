import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type {
  Book,
  ChatMessage,
  BreadcrumbItem,
  TreeNodeView,
  BranchOption,
} from "@pi-reader/shared";
import { startSession, resetSession, sendMessageStreaming, viewScope, streamLookup, saveGlossary } from "../api";
import { useUser } from "../UserContext";
import { ChatView } from "./ChatView";
import { WelcomeState, type SessionMode } from "./WelcomeState";
import { Sidebar } from "./Sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { DictionaryPanel, type DictEntry } from "./DictionaryPanel";
import { BookContentPanel } from "./BookContentPanel";
import { GitBranch, BookA, BookOpen, X, RotateCcw } from "lucide-react";
import "./Reader.css";

interface ReaderProps {
  book: Book;
}

export function Reader({ book }: ReaderProps) {
  const navigate = useNavigate();
  const { userId } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [tree, setTree] = useState<TreeNodeView | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"dict" | "book">("dict");
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const [showWelcome, setShowWelcome] = useState(false);
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
        onDone: (result) => {
          setStreamingContent(null);
          setIsLoading(false);
          applySessionData(result);
          // Server may have changed the active node — replace (not push)
          updateUrl(result.viewNodeId, true);
        },
        onError: (err) => {
          setStreamingContent(null);
          setIsLoading(false);
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
    (term: string) => {
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
      setRightTab("dict");

      streamLookup(userId, book.id, term, (token) => {
        setDictEntries((prev) =>
          prev.map((e) =>
            e.id === entryId ? { ...e, definition: e.definition + token } : e,
          ),
        );
      })
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
    [userId, book.id],
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

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.max(
          200,
          Math.min(600, startWidth + ev.clientX - startX),
        );
        setSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
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

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.max(
          200,
          Math.min(600, startWidth - (ev.clientX - startX)),
        );
        setRightSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [rightSidebarWidth],
  );

  // Panel toggle handlers (VS Code-style: click same = close, click different = switch)
  const toggleNavigator = useCallback(() => {
    setSidebarOpen((v) => !v);
  }, []);

  const toggleDict = useCallback(() => {
    if (rightPanelOpen && rightTab === "dict") {
      setRightPanelOpen(false);
    } else {
      setRightPanelOpen(true);
      setRightTab("dict");
    }
  }, [rightPanelOpen, rightTab]);

  const toggleBook = useCallback(() => {
    if (rightPanelOpen && rightTab === "book") {
      setRightPanelOpen(false);
    } else {
      setRightPanelOpen(true);
      setRightTab("book");
    }
  }, [rightPanelOpen, rightTab]);

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
    { id: "reset", icon: <RotateCcw size={16} />, label: "Clear Session", active: false, onClick: handleResetSession },
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
        {showWelcome ? (
          <WelcomeState
            book={book}
            onSelectMode={handleSelectMode}
            isLoading={isLoading}
          />
        ) : (
          <ChatView
            messages={messages}
            isLoading={isLoading}
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

      {/* Right sidebar: Dictionary + Book tabs */}
      {rightPanelOpen && (
        <>
          <div className="resize-handle-right" onMouseDown={handleRightResizeStart} />
          <aside className="right-sidebar">
            <div className="right-sidebar-header">
              <div className="right-sidebar-tabs">
                <button
                  className={`right-sidebar-tab ${rightTab === "dict" ? "active" : ""}`}
                  onClick={() => setRightTab("dict")}
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
              {rightTab === "dict" ? (
                <DictionaryPanel entries={dictEntries} onRemove={handleDictRemove} />
              ) : (
                <BookContentPanel bookId={book.id} />
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
