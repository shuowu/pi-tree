import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { GitFork, Home, BookOpen, StickyNote, Zap } from "lucide-react";
import "./NavMenu.css";

const NAV_ITEMS = [
  { path: "/", label: "Home", icon: Home },
  { path: "/library", label: "Library", icon: BookOpen },
  { path: "/memos", label: "Memos", icon: StickyNote },
  { path: "/usage", label: "Usage", icon: Zap },
] as const;

/**
 * Compact nav menu for session pages — replaces the simple Home button
 * with a dropdown that provides quick access to all top-level pages.
 */
export function NavMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleNav = useCallback((path: string) => {
    navigate(path);
    setOpen(false);
  }, [navigate]);

  return (
    <div className="nav-menu" ref={menuRef}>
      <button
        className={`pit-panel-toggle nav-menu-trigger ${open ? "pit-active" : ""}`}
        onClick={() => setOpen(o => !o)}
        title="Navigate"
        aria-label="Navigate to page"
        aria-expanded={open}
      >
        <GitFork size={16} />
      </button>

      {open && (
        <div className="nav-menu-dropdown" role="menu">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <button
              key={path}
              className="nav-menu-item"
              onClick={() => handleNav(path)}
              role="menuitem"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
