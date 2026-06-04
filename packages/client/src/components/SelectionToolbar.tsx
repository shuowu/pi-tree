import { useCallback, useEffect, useRef, useState } from "react";
import "./SelectionToolbar.css";

interface SelectionToolbarProps {
  /** Define: sends term to right sidebar dictionary panel */
  onDefine: (text: string) => void;
  /** Ask: prefills chat input */
  onAsk: (text: string) => void;
  /** Container element to listen for selections in */
  containerRef: React.RefObject<HTMLElement | null>;
}

interface ToolbarPosition {
  top: number;
  left: number;
}

export function SelectionToolbar({
  onDefine,
  onAsk,
  containerRef,
}: SelectionToolbarProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [position, setPosition] = useState<ToolbarPosition | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    setSelectedText(null);
    setPosition(null);
  }, []);

  const handleMouseUp = useCallback(() => {
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

      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;

      setSelectedText(text);
      setPosition({
        top: rect.top - containerRect.top + scrollTop - 44,
        left: Math.min(
          Math.max(rect.left - containerRect.left + rect.width / 2, 80),
          containerRect.width - 80,
        ),
      });
    });
  }, [containerRef]);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedText) return;

    container.addEventListener("scroll", dismiss);
    return () => container.removeEventListener("scroll", dismiss);
  }, [containerRef, selectedText, dismiss]);

  if (!selectedText || !position) return null;

  const handleDefine = () => {
    onDefine(selectedText);
    dismiss();
  };

  const handleAsk = () => {
    onAsk(selectedText);
    dismiss();
  };

  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="selection-toolbar-buttons">
        <button className="selection-btn" onClick={handleDefine} title="Look up in dictionary">
          📖 Define
        </button>
        <button className="selection-btn" onClick={handleAsk} title="Ask in chat">
          💬 Ask
        </button>
      </div>
    </div>
  );
}
