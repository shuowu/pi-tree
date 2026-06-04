import { useCallback, useEffect, useRef, useState } from "react";
import "./SelectionToolbar.css";

interface SelectionToolbarProps {
  /** Prefill the chat input with a question about the selected text */
  onAsk: (text: string) => void;
  /** Look up a definition (ephemeral, non-branching) */
  onDefine: (text: string) => void;
  /** Save to glossary */
  onSave: (text: string) => void;
  /** Container element to listen for selections in */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Streaming definition result from parent */
  defineResult: string | null;
}

interface ToolbarPosition {
  top: number;
  left: number;
}

export function SelectionToolbar({
  onAsk,
  onDefine,
  onSave,
  containerRef,
  defineResult,
}: SelectionToolbarProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const [isDefining, setIsDefining] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // When defineResult changes and we're defining, update state
  useEffect(() => {
    if (defineResult !== null && defineResult.length > 0) {
      setIsDefining(false);
    }
  }, [defineResult]);

  const dismiss = useCallback(() => {
    setSelectedText(null);
    setPosition(null);
    setIsDefining(false);
  }, []);

  const handleMouseUp = useCallback(() => {
    // Small delay to let selection finalize
    requestAnimationFrame(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (!text || text.length < 2 || text.length > 200) {
        return;
      }

      const range = selection?.getRangeAt(0);
      if (!range) return;

      const container = containerRef.current;
      if (!container || !container.contains(range.commonAncestorContainer)) {
        return;
      }

      // Position above the selection
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;

      setSelectedText(text);
      setIsDefining(false);
      setPosition({
        top: rect.top - containerRect.top + scrollTop - 44,
        left:
          Math.min(
            Math.max(rect.left - containerRect.left + rect.width / 2, 100),
            containerRect.width - 100,
          ),
      });
    });
  }, [containerRef]);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node)
      ) {
        dismiss();
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [containerRef, handleMouseUp, handleMouseDown]);

  // Dismiss on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedText) return;

    container.addEventListener("scroll", dismiss);
    return () => container.removeEventListener("scroll", dismiss);
  }, [containerRef, selectedText, dismiss]);

  if (!selectedText || !position) return null;

  const handleAsk = () => {
    onAsk(selectedText);
    dismiss();
  };

  const handleDefine = () => {
    setIsDefining(true);
    onDefine(selectedText);
  };

  const handleSave = () => {
    onSave(selectedText);
    dismiss();
  };

  const showDefinePopup = defineResult !== null && defineResult.length > 0;

  return (
    <div
      ref={toolbarRef}
      className={`selection-toolbar ${showDefinePopup ? "expanded" : ""}`}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="selection-toolbar-buttons">
        <button
          className="selection-btn"
          onClick={handleDefine}
          disabled={isDefining}
          title="Look up definition"
        >
          📖 {isDefining ? "…" : "Define"}
        </button>
        <button className="selection-btn" onClick={handleAsk} title="Ask in chat">
          💬 Ask
        </button>
        <button className="selection-btn" onClick={handleSave} title="Save to glossary">
          📌 Save
        </button>
      </div>
      {showDefinePopup && (
        <div className="selection-define-result">
          <div className="selection-define-term">📖 {selectedText}</div>
          <div className="selection-define-text">{defineResult}</div>
        </div>
      )}
    </div>
  );
}
