import { useCallback, useEffect, useRef, useState } from "react";
import { BookA, GitBranch, Highlighter, Pin, Quote } from "lucide-react";
import "./SelectionToolbar.css";

interface SelectionToolbarProps {
  /** Define: sends term + surrounding context to right sidebar dictionary panel */
  onDefine: (text: string, context?: string) => void;
  /** Ask: prefills chat input */
  onAsk?: (text: string) => void;
  /** Branch: quotes text and starts a new branch */
  onBranch?: (text: string) => void;
  /** Save: saves selected text as a memo */
  onSave?: (text: string, context?: string) => void;
  /** Highlight: receives the selected range (a copy — the selection is cleared after) */
  onHighlight?: (range: Range) => void;
  /** Container element to listen for selections in */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Longest selection that shows the toolbar (default 200). Raise it to quote passages;
   *  Define still only appears for selections up to 200 chars. */
  maxLength?: number;
}

const DEFINE_MAX_LENGTH = 200;

interface ToolbarPosition {
  top: number;
  left: number;
}

export function SelectionToolbar({
  onDefine,
  onAsk,
  onBranch,
  onSave,
  onHighlight,
  containerRef,
  maxLength = DEFINE_MAX_LENGTH,
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

    if (!text || text.length < 2 || text.length > maxLength) {
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
  }, [containerRef, maxLength]);

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
      // Walk up to the nearest block-level container (.pit-chat-content or <p>)
      const container =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as HTMLElement);
      const blockParent = container?.closest(".pit-chat-content, p, blockquote, li");
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
    if (onAsk) {
      onAsk(selectedText!);
    }
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  const handleBranch = () => {
    if (onBranch) {
      onBranch(selectedText!);
    }
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  const handleSave = () => {
    const selection = window.getSelection();
    let context: string | undefined;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as HTMLElement);
      const blockParent = container?.closest('.pit-chat-content, p, blockquote, li');
      if (blockParent) {
        const fullText = blockParent.textContent ?? '';
        const selText = selectedText ?? '';
        const idx = fullText.indexOf(selText);
        if (idx >= 0) {
          const start = Math.max(0, idx - 100);
          const end = Math.min(fullText.length, idx + selText.length + 100);
          context = fullText.slice(start, end).trim();
        } else {
          context = fullText.slice(0, 200).trim();
        }
      }
    }
    onSave!(selectedText!, context);
    window.getSelection()?.removeAllRanges();
    dismiss();
  };

  const handleHighlight = () => {
    const selection = window.getSelection();
    if (onHighlight && selection && selection.rangeCount > 0) {
      onHighlight(selection.getRangeAt(0).cloneRange());
    }
    selection?.removeAllRanges();
    dismiss();
  };

  return (
    <div
      ref={toolbarRef}
      className="pit-selection-toolbar"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <div className="pit-selection-toolbar-buttons">
        {onHighlight && (
          <button className="pit-selection-btn" onClick={handleHighlight} title="Highlight">
            <Highlighter size={14} /> Highlight
          </button>
        )}
        {onAsk && (
          <button className="pit-selection-btn" onClick={handleAsk} title="Quote in chat">
            <Quote size={14} /> Quote
          </button>
        )}
        {onBranch && (
          <button className="pit-selection-btn" onClick={handleBranch} title="Quote and start a new branch">
            <GitBranch size={14} /> Branch
          </button>
        )}
        {selectedText.length <= DEFINE_MAX_LENGTH && (
          <button className="pit-selection-btn" onClick={handleDefine} title="Look up in dictionary">
            <BookA size={14} /> Define
          </button>
        )}
        {onSave && (
          <button className="pit-selection-btn" onClick={handleSave} title="Save as memo">
            <Pin size={14} /> Save
          </button>
        )}
      </div>
    </div>
  );
}
