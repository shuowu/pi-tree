import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import type { BookSession } from "@pi-tree/shared";
import type { SessionMode } from "./WelcomeState";
import { fetchSessions, createSession, updateSession, deleteSession } from "../api";
import { useUser } from "../UserContext";
import { SessionPicker } from "./SessionPicker";
import { useBook } from "./BookLayout";
import { Breadcrumb } from "@pi-tree/ui";
import { Home } from "lucide-react";
import "./SessionsPage.css";

const MODE_TITLES: Record<SessionMode, string> = {
  reading: "Interactive Reading",
  qa: "Freeform Q&A",
};

export function SessionsPage() {
  const book = useBook();
  const { userId } = useUser();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<BookSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    (async () => {
      try {
        const list = await fetchSessions(userId, book.id);
        if (!cancelled) setSessions(list);
      } catch {
        // If fetch fails, start with empty list
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, book.id]);

  const handleSelectSession = (session: BookSession) => {
    navigate(`/book/${book.id}?session=${session.id}`);
  };

  const handleNewSession = async (mode: SessionMode) => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const title = MODE_TITLES[mode];
      const newSession = await createSession(userId, book.id, title, { mode });
      navigate(`/book/${book.id}?session=${newSession.id}&new=${mode}`);
    } catch {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!userId) return;
    try {
      await deleteSession(userId, book.id, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      // Silently fail — session may already be deleted
    }
  };

  const handleRenameSession = async (sessionId: number, newTitle: string) => {
    if (!userId) return;
    try {
      await updateSession(userId, book.id, sessionId, { title: newTitle });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)),
      );
    } catch {
      // Silently fail
    }
  };

  const panelToggles = useMemo(() => [
    { id: "home", icon: <Home size={16} />, label: "Library", active: false, onClick: () => navigate("/") },
  ], [navigate]);

  return (
    <div className="sessions-page">
      <Breadcrumb
        items={[]}
        onNavigate={() => {}}
        bookTitle={book.title}
        isScoped={false}
        panelToggles={panelToggles}
      />

      <SessionPicker
        book={book}
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        isLoading={isLoading}
      />
    </div>
  );
}
