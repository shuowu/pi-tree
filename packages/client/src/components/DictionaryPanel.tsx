import { useEffect, useRef } from "react";
import { useMermaid } from "@pi-tree/ui";
import { marked } from "marked";
import { BookA, X } from "lucide-react";
import "./DictionaryPanel.css";

export interface DictEntry {
  id: string;
  term: string;
  definition: string;
  /** Whether definition is still streaming */
  streaming: boolean;
  timestamp: string;
}

interface DictionaryPanelProps {
  entries: DictEntry[];
  onRemove: (id: string) => void;
}

export function DictionaryPanel({ entries, onRemove }: DictionaryPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest entry when streaming
  useEffect(() => {
    if (entries.length > 0 && entries[entries.length - 1].streaming) {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="dict-empty">
        <BookA size={28} className="dict-empty-icon" strokeWidth={1.5} />
        <p>Select text in chat to look up words</p>
        <p className="dict-empty-hint">
          Quick definitions and translations
        </p>
      </div>
    );
  }

  return (
    <div className="dict-panel" ref={listRef}>
      {entries.map((entry) => (
        <DictCard key={entry.id} entry={entry} onRemove={onRemove} />
      ))}
    </div>
  );
}

function DictCard({
  entry,
  onRemove,
}: {
  entry: DictEntry;
  onRemove: (id: string) => void;
}) {
  const html = marked.parse(entry.definition) as string;
  const bodyRef = useRef<HTMLDivElement>(null);

  useMermaid(bodyRef, html);

  return (
    <div className={`dict-card ${entry.streaming ? "streaming" : ""}`}>
      <div className="dict-card-header">
        <span className="dict-card-term">{entry.term}</span>
        <button
          className="dict-card-remove"
          onClick={() => onRemove(entry.id)}
          title="Remove"
        >
          ×
        </button>
      </div>
      <div
        ref={bodyRef}
        className="dict-card-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {entry.streaming && <span className="dict-card-cursor">█</span>}
    </div>
  );
}

/**
 * Floating mini-card shown at the bottom of the right sidebar
 * when a lookup is triggered from the Book tab.
 */
export function DictQuickCard({
  entry,
  onDismiss,
  onGoToDict,
}: {
  entry: DictEntry;
  onDismiss: () => void;
  onGoToDict: () => void;
}) {
  const html = marked.parse(entry.definition) as string;
  const bodyRef = useRef<HTMLDivElement>(null);

  useMermaid(bodyRef, html);

  return (
    <div className={`dict-quick-card ${entry.streaming ? "streaming" : ""}`}>
      <div className="dict-quick-card-header">
        <span className="dict-card-term">{entry.term}</span>
        <button
          className="dict-quick-card-close"
          onClick={onDismiss}
          title="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
      <div
        ref={bodyRef}
        className="dict-card-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {entry.streaming && <span className="dict-card-cursor">█</span>}
      {!entry.streaming && (
        <button className="dict-quick-card-link" onClick={onGoToDict}>
          View in Dictionary →
        </button>
      )}
    </div>
  );
}
