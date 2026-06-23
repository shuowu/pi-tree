import { forwardRef, useRef, useMemo } from "react";
import { useMermaid } from "./hooks/useMermaid.js";
import "./marked-config.js"; // side-effect: registers KaTeX + link extensions
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
      <div ref={ref} className="pit-chat-message pit-chat-message-assistant pit-streaming">
        <div className="pit-chat-avatar">✦</div>
        <div className="pit-chat-bubble">
          <div
            ref={contentRef}
            className="pit-chat-content pit-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {isCompacting && (
            <div className="pit-compaction-indicator">
              <span className="pit-compaction-dot" />
              Organizing reading notes…
            </div>
          )}
        </div>
      </div>
    );
  },
);
