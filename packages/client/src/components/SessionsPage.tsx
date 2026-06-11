import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import type { SourceSession, SessionContext } from "@pi-tree/shared";
import type { SessionMode } from "./WelcomeState";
import { fetchSessions, createSession, updateSession, deleteSession, fetchProfiles } from "../api";
import { useUser } from "../UserContext";
import { SessionPicker } from "./SessionPicker";
import { useSource } from "./BookLayout";
import { Breadcrumb } from "@pi-tree/ui";
import { Home } from "lucide-react";
import "./SessionsPage.css";

const MODE_TITLES: Record<string, string> = {
  reading: "Interactive Reading",
  qa: "Freeform Q&A",
  news: "News Feed",
};

export function SessionsPage() {
  const source = useSource();
  const { userId } = useUser();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SourceSession[]>([]);
  const [customProfiles, setCustomProfiles] = useState<Array<{ name: string; label: string; description?: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    (async () => {
      try {
        const [{ sessions: list }, profileMap] = await Promise.all([
          fetchSessions(userId, { source: source.id }),
          fetchProfiles().catch(() => ({} as Record<string, { label: string; description?: string; sourceType?: string }>)),
        ]);
        if (cancelled) return;
        setSessions(list);
        // Filter: exclude built-in profiles, match by source type
        const builtinKeys = new Set([
          "book.reading", "book.qa", "book.analysis", "book",
          "news.news", "news", "router", "_default",
        ]);
        const custom = Object.entries(profileMap)
          .filter(([key, info]) => {
            if (builtinKeys.has(key)) return false;
            // Only show profiles matching the current source type (or no type = show everywhere)
            if (info.sourceType && info.sourceType !== source.type) return false;
            return true;
          })
          .map(([name, info]) => ({ name, label: info.label, description: info.description }));
        setCustomProfiles(custom);
      } catch {
        // If fetch fails, start with empty list
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, source.id, source.type]);

  const handleSelectSession = (session: SourceSession) => {
    navigate(`/source/${source.id}?session=${session.id}`);
  };

  const handleNewSession = async (mode: SessionMode, customTitle?: string, initialQuery?: string, profile?: string) => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const title = customTitle || MODE_TITLES[mode] || mode;
      const context: SessionContext = { mode, ...(profile ? { profile } : {}) };
      const newSession = await createSession(userId, source.id, title, context);
      const queryParam = initialQuery ? `&query=${encodeURIComponent(initialQuery)}` : `&new=${mode}`;
      navigate(`/source/${source.id}?session=${newSession.id}${queryParam}`);
    } catch {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!userId) return;
    try {
      await deleteSession(userId, source.id, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      // Silently fail — session may already be deleted
    }
  };

  const handleRenameSession = async (sessionId: number, newTitle: string) => {
    if (!userId) return;
    try {
      await updateSession(userId, source.id, sessionId, { title: newTitle });
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
        bookTitle={source.title}
        isScoped={false}
        panelToggles={panelToggles}
      />

      <SessionPicker
        source={source}
        sessions={sessions}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        isLoading={isLoading}
        customProfiles={customProfiles}

      />
    </div>
  );
}
