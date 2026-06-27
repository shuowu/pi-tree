import { useEffect, useRef, useState } from "react";
import { useMermaid } from "@pi-tree/ui";
import { marked } from "marked";
import { BookA, ChevronDown, X } from "lucide-react";
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
 * Stack of floating mini-cards shown at the bottom-right corner.
 * Multiple lookups coexist as stacked cards — most recent on top.
 * Click a collapsed card to expand it.
 */
export function DictQuickCardStack({
  entries,
  onDismiss,
  onGoToDict,
}: {
  entries: DictEntry[];
  onDismiss: (id: string) => void;
  onGoToDict: () => void;
}) {
  // The expanded card defaults to the most recent entry
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-expand the newest card when it arrives
  const latestId = entries.length > 0 ? entries[entries.length - 1].id : null;
  useEffect(() => {
    if (latestId) setExpandedId(latestId);
  }, [latestId]);

  if (entries.length === 0) return null;

  // If the currently expanded card was dismissed, fall back to the latest
  const activeId = entries.some((e) => e.id === expandedId)
    ? expandedId
    : latestId;

  return (
    <div className="dict-quick-stack">
      {entries.map((entry, index) => (
        <DictQuickCard
          key={entry.id}
          entry={entry}
          isExpanded={entry.id === activeId}
          zIndex={100 + index}
          onExpand={() => setExpandedId(entry.id)}
          onDismiss={() => onDismiss(entry.id)}
          onGoToDict={onGoToDict}
        />
      ))}
    </div>
  );
}

function DictQuickCard({
  entry,
  isExpanded,
  zIndex,
  onExpand,
  onDismiss,
  onGoToDict,
}: {
  entry: DictEntry;
  isExpanded: boolean;
  zIndex: number;
  onExpand: () => void;
  onDismiss: () => void;
  onGoToDict: () => void;
}) {
  const html = marked.parse(entry.definition) as string;
  const bodyRef = useRef<HTMLDivElement>(null);

  useMermaid(bodyRef, html);

  return (
    <div
      className={`dict-quick-card ${entry.streaming ? "streaming" : ""} ${isExpanded ? "expanded" : "collapsed"}`}
      style={{ zIndex }}
      {...(!isExpanded ? { onClick: onExpand } : {})}
    >
      <div className="dict-quick-card-header">
        <span className="dict-card-term">{entry.term}</span>
        <div className="dict-quick-card-actions">
          {!isExpanded && (
            <ChevronDown size={14} className="dict-quick-card-expand-hint" />
          )}
          <button
            className="dict-quick-card-close"
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
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
