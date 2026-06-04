import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Book,
  ChatMessage,
  BreadcrumbItem,
  TreeNodeView,
  BranchOption,
} from "@pi-reader/shared";
import { startSession, sendMessageStreaming, viewScope, streamLookup, saveGlossary } from "../api";
import { ChatView } from "./ChatView";
import { Sidebar } from "./Sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { DictionaryPanel, type DictEntry } from "./DictionaryPanel";
import { BookContentPanel } from "./BookContentPanel";
import { GitBranch, BookA, BookOpen, X } from "lucide-react";
import "./Reader.css";

interface ReaderProps {
  book: Book;
  onBack: () => void;
}

export function Reader({ book, onBack }: ReaderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [tree, setTree] = useState<TreeNodeView | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [viewNodeId, setViewNodeId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"dict" | "book">("dict");
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const initialized = useRef(false);

  /** Apply session state from any API response */
  const applyState = useCallback(
    (state: {
      messages: ChatMessage[];
      breadcrumb: BreadcrumbItem[];
      tree: TreeNodeView;
      branches: BranchOption[];
      viewNodeId: string | null;
    }) => {
      setMessages(state.messages);
      setBreadcrumb(state.breadcrumb);
      setTree(state.tree);
      setBranches(state.branches);
      setViewNodeId(state.viewNodeId);
    },
    [],
  );

  const handleSendMessage = useCallback(
    async (message: string) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setStreamingContent("");

      await sendMessageStreaming(book.id, message, viewNodeId, {
        onToken: (token) => {
          setStreamingContent((prev) => (prev ?? "") + token);
        },
        onDone: (result) => {
          setStreamingContent(null);
          setIsLoading(false);
          applyState(result);
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
    [book.id, viewNodeId, applyState],
  );

  // ---------------------------------------------------------------------------
  // Dictionary
  // ---------------------------------------------------------------------------

  const handleDefine = useCallback(
    (term: string) => {
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

      streamLookup(book.id, term, (token) => {
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
          saveGlossary(book.id, term, fullDef).catch(() => {});
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
    [book.id],
  );

  const handleAsk = useCallback(
    (text: string) => {
      // This will be called from ChatView — it just prefills, we don't handle it here
      // ChatView handles it internally via setInput
    },
    [],
  );

  const handleDictRemove = useCallback((id: string) => {
    setDictEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const handleNavigate = useCallback(
    async (nodeId: string) => {
      setIsLoading(true);
      try {
        const state = await viewScope(book.id, nodeId);
        applyState(state);
      } catch (err) {
        console.error("Navigate failed:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [book.id, applyState],
  );

  const handleBackToRoot = useCallback(async () => {
    setIsLoading(true);
    try {
      const state = await viewScope(book.id, null);
      applyState(state);
    } catch (err) {
      console.error("Back to root failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [book.id, applyState]);

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

  // On mount: load existing session
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    (async () => {
      setIsLoading(true);
      try {
        const state = await startSession(book.id);

        if (state.messages.length > 0) {
          applyState(state);
          setIsLoading(false);
        } else {
          setIsLoading(false);
          handleSendMessage(
            `Let's start reading "${book.title}" by ${book.author}. Give me a chapter briefing to begin.`,
          );
        }
      } catch {
        setIsLoading(false);
      }
    })();
  }, [book, applyState, handleSendMessage]);

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

  const panelToggles = [
    { id: "nav", icon: <GitBranch size={16} />, label: "Session Tree", active: sidebarOpen, onClick: toggleNavigator },
    { id: "dict", icon: <BookA size={16} />, label: "Dictionary", active: rightPanelOpen && rightTab === "dict", onClick: toggleDict },
    { id: "book", icon: <BookOpen size={16} />, label: "Book", active: rightPanelOpen && rightTab === "book", onClick: toggleBook },
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
      <Sidebar
        bookId={book.id}
        tree={tree}
        viewNodeId={viewNodeId}
        onNavigate={handleNavigate}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
      {sidebarOpen && (
        <div className="resize-handle" onMouseDown={handleResizeStart} />
      )}
      <main className="reader-main">
        <Breadcrumb
          items={breadcrumb}
          onNavigate={handleNavigate}
          onBack={viewNodeId ? handleBackToRoot : onBack}
          onRoot={handleBackToRoot}
          bookTitle={book.title}
          isScoped={viewNodeId !== null}
          panelToggles={panelToggles}
        />
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
