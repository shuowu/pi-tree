import { useNavigate, useLocation } from "react-router";
import { useUser } from "../UserContext";
import { useAddSource } from "../AddSourceContext";
import { GitFork, Search, LogOut, BookOpen, StickyNote, Zap, Compass, Plus } from "lucide-react";
import "./AppHeader.css";

interface AppHeaderProps {
  /** Callback to open the spotlight search (⌘K). Only shown on HomePage */
  onOpenSpotlight?: () => void;
}

const NAV_ITEMS = [
  { path: "/library", label: "Library", icon: BookOpen },
  { path: "/discover", label: "Discover", icon: Compass },
  { path: "/memos", label: "Memos", icon: StickyNote },
  { path: "/usage", label: "Usage", icon: Zap },
] as const;

export function AppHeader({ onOpenSpotlight }: AppHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { displayName, clearUser } = useUser();
  const { openAddSource } = useAddSource();

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button className="app-header-logo" onClick={() => navigate("/")} title="Home">
          <GitFork size={22} strokeWidth={1.5} />
          <span>Pi Tree</span>
        </button>
      </div>

      <nav className="app-header-nav">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            className={`app-header-nav-link ${location.pathname === path ? "active" : ""}`}
            onClick={() => navigate(path)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="app-header-right">
        <button
          className="app-header-icon-btn"
          onClick={openAddSource}
          title="Add source"
        >
          <Plus size={16} strokeWidth={2} />
        </button>

        {onOpenSpotlight && (
          <button
            className="app-header-btn"
            onClick={onOpenSpotlight}
            title="Search (⌘K)"
          >
            <Search size={14} />
            <kbd className="app-header-kbd">⌘K</kbd>
          </button>
        )}

        <a
          className="app-header-icon-btn"
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
          <button className="app-header-user-pill" onClick={clearUser} title="Switch user">
            <span className="app-header-user-avatar">
              {displayName.charAt(0).toUpperCase()}
            </span>
            {displayName}
            <LogOut size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
