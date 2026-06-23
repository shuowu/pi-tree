import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import type { SourceSession } from "@pi-tree/shared";
import { fetchSessions } from "../api";
import { useUser } from "../UserContext";
import { GitFork, LogOut, Search } from "lucide-react";
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
  const { userId, displayName, clearUser } = useUser();
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRecentSessions();
  }, [loadRecentSessions]);

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-header-left">
          <h1><GitFork size={24} strokeWidth={1.5} /> <span>Pi Tree</span></h1>
        </div>
        <div className="home-header-right">
          <button
            className="home-nav-btn spotlight-trigger"
            onClick={onOpenSpotlight}
            title="Search (⌘K)"
          >
            <Search size={16} />
            <kbd className="home-kbd">⌘K</kbd>
          </button>
          <a
            className="home-nav-btn"
            href="https://github.com/shuowu/pi-tree"
            target="_blank"
            rel="noopener noreferrer"
            title="View on GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
          {displayName && (
            <button className="home-user-pill" onClick={clearUser} title="Switch user">
              <span className="home-user-avatar">
                {displayName.charAt(0).toUpperCase()}
              </span>
              {displayName}
              <LogOut size={14} />
            </button>
          )}
        </div>
      </header>

      {/* Hero — centered chat */}
      <div className="home-hero">
        <p className="home-greeting">{greeting}{displayName ? `, ${displayName}` : ""}</p>
        <RouterChat userId={userId!} />
        <div className="home-quick-actions">
          <button className="home-quick-chip" onClick={() => navigate("/library")}>📚 Library</button>
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
            renderSubtitle={(rs) => rs.sourceTitle}
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
