import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import type { RecentSession } from "@pi-tree/shared";
import { fetchRecentSessions } from "../api";
import { useUser } from "../UserContext";
import { TreePine, LogOut, BookOpen, Settings, Search, Rss } from "lucide-react";
import { RouterChat } from "./RouterChat";
import { SettingsModal } from "./SettingsModal";
import { FeedManagerModal } from "./FeedManagerModal";
import { getSourceTypeConfig } from "../source-types";
import "./HomePage.css";

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

  // Continue rail state
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const loadRecentSessions = useCallback(async () => {
    if (!userId) return;
    setRecentLoading(true);
    try {
      const sessions = await fetchRecentSessions(userId, { limit: 8 });
      setRecentSessions(sessions);
    } catch {
      setRecentSessions([]);
    } finally {
      setRecentLoading(false);
    }
  }, [userId]);

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
            className="home-nav-btn"
            onClick={() => navigate("/library")}
          >
            <BookOpen size={16} />
            Library
          </button>
          <button
            className="home-nav-btn spotlight-trigger"
            onClick={onOpenSpotlight}
            title="Search (⌘K)"
          >
            <Search size={16} />
            <kbd className="home-kbd">⌘K</kbd>
          </button>
          <button
            className="home-nav-btn"
            onClick={() => setShowFeedManager(true)}
            title="Manage RSS feeds"
          >
            <Rss size={16} />
          </button>
          <button
            className="home-nav-btn"
            onClick={() => setShowSettingsModal(true)}
            title="Settings"
          >
            <Settings size={16} />
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
        <p className="home-greeting">What would you like to read or explore?</p>
        <RouterChat userId={userId} />
      </div>

      {/* Continue rail — recent sessions */}
      {!recentLoading && recentSessions.length > 0 && (
        <div className="home-continue">
          <span className="home-continue-title">Continue</span>
          <div className="home-continue-rail">
            {recentSessions.map((rs) => {
              const config = getSourceTypeConfig(rs.sourceType);
              const Icon = config.icon;
              return (
                <button
                  key={`${rs.sourceId}-${rs.sessionId}`}
                  className="home-continue-card"
                  onClick={() => navigate(`/source/${rs.sourceId}?session=${rs.sessionId}`)}
                >
                  <div className="home-continue-card-top">
                    <div className="home-continue-card-icon">
                      <Icon size={16} />
                    </div>
                    <span className="home-continue-card-source">{rs.sourceTitle}</span>
                  </div>
                  <div className="home-continue-card-session">{rs.sessionTitle}</div>
                  <div className="home-continue-card-time">{timeAgo(rs.lastActiveAt)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {recentLoading && (
        <div className="home-continue">
          <span className="home-continue-title">Continue</span>
          <div className="home-continue-rail">
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
    </div>
  );
}
