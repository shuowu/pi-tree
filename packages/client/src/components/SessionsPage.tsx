import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router";
import type { SourceSession, SessionContext } from "@pi-tree/shared";
import { fetchSessions, createSession, updateSession, deleteSession, fetchProfiles, exportSessionUrl, importSession } from "../api";
import type { ProfileInfo } from "../api";
import { useUser } from "../UserContext";
import { SessionPicker } from "./SessionPicker";
import { useSource } from "./SourceLayout";
import { Breadcrumb } from "@pi-tree/ui";
import { Home, Settings, Plus } from "lucide-react";
import { SourceSettingsModal } from "./SourceSettingsModal";
import { useAddSource } from "../AddSourceContext";
import "./SessionsPage.css";

type SessionMode = string;

export function SessionsPage() {
  const source = useSource();
  const { userId } = useUser();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SourceSession[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileInfo>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const { openAddSource } = useAddSource();

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    (async () => {
      try {
        const [{ sessions: list }, profileMap] = await Promise.all([
          fetchSessions(userId, { source: source.id }),
          fetchProfiles().catch(() => ({} as Record<string, ProfileInfo>)),
        ]);
        if (cancelled) return;
        setSessions(list);
        setProfiles(profileMap);
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
      // Use profile label as title fallback, then mode name
      const profileInfo = profile ? profiles[profile] : profiles[`${source.type}.${mode}`] || profiles[mode];
      const title = customTitle || profileInfo?.label || mode;
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

  const handleExportSession = (sessionId: number, format: "html" | "jsonl") => {
    if (!userId) return;
    const a = document.createElement("a");
    a.href = exportSessionUrl(userId, source.id, sessionId, format);
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleImportFile = async (file: File) => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const text = await file.text();
      const session = await importSession(userId, text);
      // The bundle carries its own source — navigate to wherever it landed
      navigate(`/source/${session.sourceId}?session=${session.id}`);
    } catch (err) {
      setIsLoading(false);
      alert(err instanceof Error ? err.message : "Import failed");
    }
  };

  const panelToggles = useMemo(() => [
    { id: "home", icon: <Home size={16} />, label: "Library", active: false, onClick: () => navigate("/") },
    { id: "add-source", icon: <Plus size={16} />, label: "Add Source", active: false, onClick: openAddSource },
    { id: "settings", icon: <Settings size={16} />, label: "Settings", active: showSettings, onClick: () => setShowSettings(true) },
  ], [navigate, showSettings, openAddSource]);

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
        profiles={profiles}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onExportSession={handleExportSession}
        onImportFile={handleImportFile}
        isLoading={isLoading}
      />

      {showSettings && (
        <SourceSettingsModal
          source={source}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
