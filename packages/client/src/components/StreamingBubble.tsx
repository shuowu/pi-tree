import { forwardRef, useRef, useMemo } from "react";
import { useMermaid } from "../hooks/useMermaid";
import { marked } from "marked";

/**
 * Live-updating bubble that renders progressive markdown while streaming.
 * Industry-standard pattern (ChatGPT, Claude, Gemini): markdown renders in
 * real-time with a pulsing avatar + blinking cursor to signal generation.
 * When streaming ends, content moves to MessageBubble and indicators vanish.
 */
export const StreamingBubble = forwardRef<HTMLDivElement, { content: string; isCompacting?: boolean }>(
  function StreamingBubble({ content, isCompacting }, ref) {
    const contentRef = useRef<HTMLDivElement>(null);
    const html = useMemo(() => {
      return marked.parse(content) as string;
    }, [content]);

    // Skip mermaid during streaming — incomplete fences would produce errors.
    // Once streaming ends, content moves to MessageBubble which renders mermaid.
    useMermaid(contentRef, html, /* enabled */ false);

    return (
      <div ref={ref} className="chat-message chat-message-assistant streaming">
        <div className="chat-avatar">✦</div>
        <div className="chat-bubble">
          <div
            ref={contentRef}
            className="chat-content markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {isCompacting && (
            <div className="compaction-indicator">
              <span className="compaction-dot" />
              Organizing reading notes…
            </div>
          )}
        </div>
      </div>
    );
  },
);
