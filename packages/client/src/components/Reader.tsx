import { useCallback, useEffect, useRef, useState } from "react";
import type { Book, ChatMessage, BreadcrumbItem, TreeNodeView } from "@pi-reader/shared";
import { sendMessage } from "../api";
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
  const initialized = useRef(false);

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
      setMessages(result.messages);
      setBreadcrumb(result.breadcrumb);
      setTree(result.tree);
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
  }, [book.id]);

  const handleNavigate = useCallback(async (nodeId: string) => {
    // TODO: Call navigateTo API
    console.log("Navigate to:", nodeId);
  }, []);

  // Send initial message on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    handleSendMessage(
      `Let's start reading "${book.title}" by ${book.author}. Give me a chapter briefing to begin.`
    );
  }, [book, handleSendMessage]);

  return (
    <div className={`reader ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Sidebar
        bookId={book.id}
        tree={tree}
        onNavigate={handleNavigate}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
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
