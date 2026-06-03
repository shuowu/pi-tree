import type { BreadcrumbItem } from "@pi-reader/shared";
import "./Breadcrumb.css";

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (nodeId: string) => void;
  onBack: () => void;
  bookTitle: string;
}

export function Breadcrumb({ items, onNavigate, onBack, bookTitle }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb-bar" aria-label="Reading path">
      <button className="breadcrumb-back" onClick={onBack} aria-label="Back to library">
        ←
      </button>

      <div className="breadcrumb-items">
        <span className="breadcrumb-book">{bookTitle}</span>

        {items.map((item, i) => (
          <span key={item.nodeId} className="breadcrumb-segment">
            <span className="breadcrumb-sep">/</span>
            {i === items.length - 1 ? (
              <span className="breadcrumb-current">{item.label}</span>
            ) : (
              <button
                className="breadcrumb-link"
                onClick={() => onNavigate(item.nodeId)}
              >
                {item.label}
              </button>
            )}
          </span>
        ))}
      </div>
    </nav>
  );
}
