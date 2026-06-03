import { useCallback, useEffect, useRef, useState } from "react";
import type { Book, ChatMessage, BreadcrumbItem, TreeNodeView } from "@pi-reader/shared";
import { startSession, sendMessage, navigateTo } from "../api";
import { ChatView } from "./ChatView";
import { Sidebar } from "./Sidebar";
import { Breadcrumb } from "./Breadcrumb";
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const initialized = useRef(false);

  /** Apply session state from any API response */
  const applyState = useCallback((state: {
    messages: ChatMessage[];
    breadcrumb: BreadcrumbItem[];
    tree: TreeNodeView;
  }) => {
    setMessages(state.messages);
    setBreadcrumb(state.breadcrumb);
    setTree(state.tree);
  }, []);

  const handleSendMessage = useCallback(async (message: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const result = await sendMessage(book.id, message);
      applyState(result);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ Error: ${err instanceof Error ? err.message : "Something went wrong"}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [book.id, applyState]);

  const handleNavigate = useCallback(async (nodeId: string) => {
    setIsLoading(true);
    try {
      const state = await navigateTo(book.id, nodeId);
      applyState(state);
    } catch (err) {
      console.error("Navigate failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [book.id, applyState]);

  // Drag-to-resize sidebar
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + ev.clientX - startX));
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
  }, [sidebarWidth]);

  // On mount: load existing session, only auto-prompt if fresh
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
            `Let's start reading "${book.title}" by ${book.author}. Give me a chapter briefing to begin.`
          );
        }
      } catch {
        setIsLoading(false);
      }
    })();
  }, [book, applyState, handleSendMessage]);

  const cssVars = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as React.CSSProperties;

  return (
    <div className={`reader ${sidebarOpen ? "sidebar-open" : ""}`} style={cssVars}>
      <Sidebar
        bookId={book.id}
        tree={tree}
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
          onBack={onBack}
          bookTitle={book.title}
        />
        <ChatView
          messages={messages}
          isLoading={isLoading}
          onSendMessage={handleSendMessage}
        />
      </main>
    </div>
  );
}
