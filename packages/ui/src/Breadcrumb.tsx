import type { BreadcrumbItem } from "@pi-tree/core/types";
import type { ReactNode } from "react";
import "./styles/Breadcrumb.css";

interface PanelToggle {
  id: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (nodeId: string) => void;
  bookTitle: string;
  isScoped: boolean;
  /** All header action icons, rendered on the right */
  panelToggles?: PanelToggle[];
  /** Currently active session name, shown as a subtle label */
  sessionLabel?: string | null;
  /** Optional element rendered before the breadcrumb items (e.g. NavMenu) */
  leftSlot?: ReactNode;
}

/** Truncate a label to maxLen chars */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

export function Breadcrumb({ items, onNavigate, bookTitle, isScoped, panelToggles, sessionLabel, leftSlot }: BreadcrumbProps) {
  // Only show the last 2 breadcrumb items; collapse earlier ones into "…"
  const collapsed = items.length > 2;
  const visibleItems = collapsed ? items.slice(-2) : items;

  return (
    <nav className="pit-breadcrumb-bar" aria-label="Reading path">
      {leftSlot}
      <div className="pit-breadcrumb-items">
        {isScoped ? (
          <button className="pit-breadcrumb-link pit-breadcrumb-root" onClick={() => onNavigate("")}>
            {truncate(bookTitle, 24)}
          </button>
        ) : (
          <span className="pit-breadcrumb-book">{truncate(bookTitle, 30)}</span>
        )}

        {sessionLabel && (
          <span className="pit-breadcrumb-session-label" title={sessionLabel}>
            {truncate(sessionLabel, 20)}
          </span>
        )}

        {collapsed && (
          <span className="pit-breadcrumb-segment">
            <span className="pit-breadcrumb-sep">/</span>
            <span className="pit-breadcrumb-ellipsis" title={items.slice(0, -2).map(i => i.label).join(" / ")}>
              …
            </span>
          </span>
        )}

        {visibleItems.map((item, i) => (
          <span key={item.nodeId} className="pit-breadcrumb-segment">
            <span className="pit-breadcrumb-sep">/</span>
            {i === visibleItems.length - 1 ? (
              <span className="pit-breadcrumb-current" title={item.label}>
                {truncate(item.label, 30)}
              </span>
            ) : (
              <button
                className="pit-breadcrumb-link"
                onClick={() => onNavigate(item.nodeId)}
                title={item.label}
              >
                {truncate(item.label, 20)}
              </button>
            )}
          </span>
        ))}
      </div>

      {/* All action icons grouped on the right */}
      {panelToggles && panelToggles.length > 0 && (
        <div className="pit-panel-toggles">
          {panelToggles.map((toggle) => (
            <button
              key={toggle.id}
              className={`pit-panel-toggle ${toggle.active ? "pit-active" : ""}`}
              onClick={toggle.onClick}
              title={toggle.label}
              aria-label={toggle.label}
              data-testid={`panel-toggle-${toggle.id}`}
            >
              {toggle.icon}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
