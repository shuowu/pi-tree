import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import type { SourceSession } from "@pi-tree/shared";
import { fetchSessions } from "../api";
import { useUser } from "../UserContext";
import { AppHeader } from "./AppHeader";
import { RouterChat } from "./RouterChat";
import { SettingsModal } from "./SettingsModal";
import { AddSourceModal } from "./AddSourceModal";
import { SessionList } from "./SessionList";
import { getSourceTypeConfig } from "../source-types";
import "./HomePage.css";

/** Return a time-of-day greeting string. */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

interface HomePageProps {
  onOpenSpotlight: () => void;
}

export function HomePage({ onOpenSpotlight }: HomePageProps) {
  const navigate = useNavigate();
  const { userId, displayName } = useUser();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const greeting = useMemo(() => getGreeting(), []);

  // Continue section state
  const [recentSessions, setRecentSessions] = useState<SourceSession[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 5;

  const loadRecentSessions = useCallback(async (offset = 0, append = false) => {
    if (!userId) return;
    if (!append) setRecentLoading(true);
    try {
      const { sessions, hasMore: more } = await fetchSessions(userId, {
        limit: PAGE_SIZE,
        offset,
      });
      setRecentSessions((prev) => append ? [...prev, ...sessions] : sessions);
      setHasMore(more);
    } catch {
      if (!append) setRecentSessions([]);
      setHasMore(false);
    } finally {
      setRecentLoading(false);
    }
  }, [userId]);

  const handleShowMore = useCallback(() => {
    loadRecentSessions(recentSessions.length, true);
  }, [recentSessions.length, loadRecentSessions]);

  const handleShowLess = useCallback(() => {
    loadRecentSessions(0, false);
  }, [loadRecentSessions]);

  useEffect(() => {
    loadRecentSessions();
  }, [loadRecentSessions]);

  return (
    <div className="home-page">
      <AppHeader onOpenSpotlight={onOpenSpotlight} />

      {/* Hero — centered chat */}
      <div className="home-hero">
        <p className="home-greeting">{greeting}{displayName ? `, ${displayName}` : ""}</p>
        <RouterChat userId={userId!} />
        <div className="home-quick-actions">
          <button className="home-quick-chip" onClick={() => setShowAddSource(true)}>➕ Add Source</button>
          <button className="home-quick-chip" onClick={() => setShowSettingsModal(true)}>⚙️ Settings</button>
        </div>
      </div>

      {/* Continue — recent sessions */}
      {!recentLoading && recentSessions.length > 0 && (
        <div className="home-continue">
          <span className="home-continue-title">Continue</span>
          <SessionList
            sessions={recentSessions}
            renderIcon={(rs) => {
              const config = getSourceTypeConfig(rs.sourceType ?? 'book');
              const Icon = config.icon;
              return <Icon size={16} />;
            }}
            renderTitle={(rs) => rs.sourceType === 'book' ? (rs.sourceTitle || rs.title) : undefined}
            renderSubtitle={(rs) => rs.sourceType === 'book' ? rs.title : rs.sourceTitle}
            onSelectSession={(rs) => navigate(`/source/${rs.sourceId}?session=${rs.id}`)}
            className="home-continue-list"
          />
          {(hasMore || recentSessions.length > PAGE_SIZE) && (
            <div className="home-continue-actions">
              {hasMore && (
                <button className="home-continue-view-all" onClick={handleShowMore}>
                  Show more
                </button>
              )}
              {recentSessions.length > PAGE_SIZE && (
                <button className="home-continue-view-all" onClick={handleShowLess}>
                  Show less
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {recentLoading && (
        <div className="home-continue">
          <span className="home-continue-title">Continue</span>
          <div className="home-continue-list">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="home-continue-skeleton" />
            ))}
          </div>
        </div>
      )}

      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
      {showAddSource && <AddSourceModal onClose={() => setShowAddSource(false)} onSuccess={() => { setShowAddSource(false); navigate("/library"); }} />}
    </div>
  );
}
