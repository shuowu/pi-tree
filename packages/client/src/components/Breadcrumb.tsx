import type { BreadcrumbItem } from "@pi-reader/shared";
import "./Breadcrumb.css";

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (nodeId: string) => void;
  onBack: () => void;
  onRoot: () => void;
  bookTitle: string;
  isScoped: boolean;
}

export function Breadcrumb({ items, onNavigate, onBack, onRoot, bookTitle, isScoped }: BreadcrumbProps) {
  return (
    <nav className="breadcrumb-bar" aria-label="Reading path">
      <button className="breadcrumb-back" onClick={onBack} aria-label="Back">
        ←
      </button>

      <div className="breadcrumb-items">
        {isScoped ? (
          <button className="breadcrumb-link" onClick={onRoot}>
            {bookTitle}
          </button>
        ) : (
          <span className="breadcrumb-book">{bookTitle}</span>
        )}

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
