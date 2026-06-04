import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
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
        <span className="dict-empty-icon">📖</span>
        <p>Select text in chat to look up words</p>
        <p className="dict-empty-hint">
          Definitions will appear here with book context
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
        className="dict-card-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {entry.streaming && <span className="dict-card-cursor">▊</span>}
    </div>
  );
}
