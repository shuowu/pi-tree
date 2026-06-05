import type { BreadcrumbItem } from "@pi-books/shared";
import type { ReactNode } from "react";
import "./Breadcrumb.css";

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
}

/** Truncate a label to maxLen chars */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

export function Breadcrumb({ items, onNavigate, bookTitle, isScoped, panelToggles }: BreadcrumbProps) {
  // Only show the last 2 breadcrumb items; collapse earlier ones into "…"
  const collapsed = items.length > 2;
  const visibleItems = collapsed ? items.slice(-2) : items;

  return (
    <nav className="breadcrumb-bar" aria-label="Reading path">
      <div className="breadcrumb-items">
        {isScoped ? (
          <button className="breadcrumb-link breadcrumb-root" onClick={() => onNavigate("")}>
            {truncate(bookTitle, 24)}
          </button>
        ) : (
          <span className="breadcrumb-book">{truncate(bookTitle, 30)}</span>
        )}

        {collapsed && (
          <span className="breadcrumb-segment">
            <span className="breadcrumb-sep">/</span>
            <span className="breadcrumb-ellipsis" title={items.slice(0, -2).map(i => i.label).join(" / ")}>
              …
            </span>
          </span>
        )}

        {visibleItems.map((item, i) => (
          <span key={item.nodeId} className="breadcrumb-segment">
            <span className="breadcrumb-sep">/</span>
            {i === visibleItems.length - 1 ? (
              <span className="breadcrumb-current" title={item.label}>
                {truncate(item.label, 30)}
              </span>
            ) : (
              <button
                className="breadcrumb-link"
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
        <div className="panel-toggles">
          {panelToggles.map((toggle) => (
            <button
              key={toggle.id}
              className={`panel-toggle ${toggle.active ? "active" : ""}`}
              onClick={toggle.onClick}
              title={toggle.label}
              aria-label={toggle.label}
            >
              {toggle.icon}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
