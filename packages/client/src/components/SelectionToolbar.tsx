import { useCallback, useEffect, useRef, useState } from "react";
import { BookA, MessageCircle } from "lucide-react";
import "./SelectionToolbar.css";

interface SelectionToolbarProps {
  /** Define: sends term + surrounding context to right sidebar dictionary panel */
  onDefine: (text: string, context?: string) => void;
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

  /** Shared logic: read selection, position toolbar */
  const showToolbarForSelection = useCallback(() => {
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
  }, [containerRef]);

  // Desktop: mouseup handler
  const handleMouseUp = useCallback(() => {
    requestAnimationFrame(() => {
      showToolbarForSelection();
    });
  }, [showToolbarForSelection]);

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        dismiss();
      }
    },
    [dismiss],
  );

  // Desktop listeners
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

  // Mobile: selectionchange fires after long-press text selection.
  // We debounce it to avoid triggering during active drag.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleSelectionChange = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || text.length < 2) {
          return;
        }
        showToolbarForSelection();
      }, 300);
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [showToolbarForSelection]);

  // Dismiss on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedText) return;

    container.addEventListener("scroll", dismiss);
    return () => container.removeEventListener("scroll", dismiss);
  }, [containerRef, selectedText, dismiss]);

  // Dismiss on touch outside toolbar (mobile equivalent of mousedown)
  useEffect(() => {
    if (!selectedText) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        dismiss();
      }
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    return () => document.removeEventListener("touchstart", handleTouchStart);
  }, [selectedText, dismiss]);

  if (!selectedText || !position) return null;

  const handleDefine = () => {
    // Capture surrounding context from the paragraph/message containing the selection
    const selection = window.getSelection();
    let context: string | undefined;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // Walk up to the nearest block-level container (.chat-content or <p>)
      const container =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as HTMLElement);
      const blockParent = container?.closest(".chat-content, p, blockquote, li");
      if (blockParent) {
        const fullText = blockParent.textContent ?? "";
        // Keep a window of ~200 chars around the selection
        const selText = selectedText ?? "";
        const idx = fullText.indexOf(selText);
        if (idx >= 0) {
          const start = Math.max(0, idx - 100);
          const end = Math.min(fullText.length, idx + selText.length + 100);
          context = fullText.slice(start, end).trim();
        } else {
          // Fallback: first 200 chars of the container
          context = fullText.slice(0, 200).trim();
        }
      }
    }
    onDefine(selectedText!, context);
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  const handleAsk = () => {
    onAsk(selectedText);
    window.getSelection()?.removeAllRanges();
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
          <BookA size={14} /> Define
        </button>
        <button className="selection-btn" onClick={handleAsk} title="Ask in chat">
          <MessageCircle size={14} /> Ask
        </button>
      </div>
    </div>
  );
}
