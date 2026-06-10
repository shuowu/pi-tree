import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import type { SourceSession } from "@pi-tree/shared";
import { fetchSessions } from "../api";
import { useUser } from "../UserContext";
import { TreePine, LogOut, Search } from "lucide-react";
import { RouterChat } from "./RouterChat";
import { SettingsModal } from "./SettingsModal";
import { FeedManagerModal } from "./FeedManagerModal";
import { AddBookModal } from "./AddBookModal";
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

/** Compute a human-readable relative time string from an ISO date */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface HomePageProps {
  onOpenSpotlight: () => void;
}

export function HomePage({ onOpenSpotlight }: HomePageProps) {
  const navigate = useNavigate();
  const { userId, displayName, clearUser } = useUser();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFeedManager, setShowFeedManager] = useState(false);
  const [showAddBook, setShowAddBook] = useState(false);
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
          <h1><TreePine size={24} strokeWidth={1.5} /> <span>Pi Tree</span></h1>
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
          <button className="home-quick-chip" onClick={() => navigate("/source/news")}>📰 News</button>
          <button className="home-quick-chip" onClick={() => navigate("/library")}>📚 Library</button>
          <button className="home-quick-chip" onClick={() => setShowAddBook(true)}>➕ Add Source</button>
          <button className="home-quick-chip" onClick={() => setShowFeedManager(true)}>📡 Feeds</button>
          <button className="home-quick-chip" onClick={() => setShowSettingsModal(true)}>⚙️ Settings</button>
        </div>
      </div>

      {/* Continue — recent sessions */}
      {!recentLoading && recentSessions.length > 0 && (
        <div className="home-continue">
          <span className="home-continue-title">Continue</span>
          <div className="home-continue-list">
            {recentSessions.map((rs) => {
              const config = getSourceTypeConfig(rs.sourceType ?? 'book');
              const Icon = config.icon;
              return (
                <button
                  key={`${rs.sourceId}-${rs.id}`}
                  className="home-continue-item"
                  onClick={() => navigate(`/source/${rs.sourceId}?session=${rs.id}`)}
                >
                  <div className="home-continue-item-icon">
                    <Icon size={16} />
                  </div>
                  <div className="home-continue-item-text">
                    <span className="home-continue-item-session">{rs.title}</span>
                    <span className="home-continue-item-source">{rs.sourceTitle}</span>
                  </div>
                  <span className="home-continue-item-time">{timeAgo(rs.lastActiveAt)}</span>
                </button>
              );
            })}
          </div>
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
      {showFeedManager && <FeedManagerModal onClose={() => setShowFeedManager(false)} />}
      {showAddBook && <AddBookModal onClose={() => setShowAddBook(false)} onSuccess={() => setShowAddBook(false)} />}
    </div>
  );
}
