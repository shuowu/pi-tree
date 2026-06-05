import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import { fetchHeadings, fetchContent, type BookHeading } from "../api";
import { SelectionToolbar } from "./SelectionToolbar";
import { BookOpen } from "lucide-react";
import "./BookContentPanel.css";

interface BookContentPanelProps {
  bookId: string;
  onDefine?: (text: string, context?: string) => void;
}

export function BookContentPanel({ bookId, onDefine }: BookContentPanelProps) {
  const [headings, setHeadings] = useState<BookHeading[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [activeHeading, setActiveHeading] = useState<BookHeading | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Load headings on mount
  useEffect(() => {
    fetchHeadings(bookId).then(setHeadings);
  }, [bookId]);

  const handleSelectHeading = useCallback(
    async (heading: BookHeading, endLine: number) => {
      setActiveHeading(heading);
      setIsLoading(true);
      try {
        const text = await fetchContent(bookId, heading.line, endLine);
        setContent(text);
        // Scroll content to top
        contentRef.current?.scrollTo(0, 0);
      } catch {
        setContent("Failed to load content.");
      } finally {
        setIsLoading(false);
      }
    },
    [bookId],
  );

  // If no headings yet, show loading
  if (headings.length === 0) {
    return (
      <div className="book-panel-empty">
        <BookOpen size={28} className="book-panel-empty-icon" strokeWidth={1.5} />
        <p>No book content available</p>
      </div>
    );
  }

  // Show TOC when no section selected, content when selected
  return (
    <div className="book-panel">
      {content === null ? (
        <BookTOC
          headings={headings}
          onSelect={handleSelectHeading}
        />
      ) : (
        <BookContent
          heading={activeHeading}
          content={content}
          isLoading={isLoading}
          contentRef={contentRef}
          onDefine={onDefine}
          onBack={() => {
            setContent(null);
            setActiveHeading(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOC view
// ---------------------------------------------------------------------------

function BookTOC({
  headings,
  onSelect,
}: {
  headings: BookHeading[];
  onSelect: (heading: BookHeading, endLine: number) => void;
}) {
  // Filter to show only level 1-3 headings for cleaner TOC
  const tocHeadings = headings.filter((h) => h.level <= 3);

  return (
    <div className="book-toc">
      <div className="book-toc-header">
        <span>Table of Contents</span>
      </div>
      <div className="book-toc-list">
        {tocHeadings.map((heading, i) => {
          // Find end line (next heading of same or higher level)
          const nextIdx = headings.findIndex(
            (h, j) => j > headings.indexOf(heading) && h.level <= heading.level,
          );
          const endLine =
            nextIdx >= 0 ? headings[nextIdx].line - 1 : heading.line + 200;

          return (
            <button
              key={`${heading.line}-${i}`}
              className={`book-toc-item level-${heading.level}`}
              onClick={() => onSelect(heading, endLine)}
            >
              {heading.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content view
// ---------------------------------------------------------------------------

function BookContent({
  heading,
  content,
  isLoading,
  contentRef,
  onDefine,
  onBack,
}: {
  heading: BookHeading | null;
  content: string;
  isLoading: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onDefine?: (text: string, context?: string) => void;
  onBack: () => void;
}) {
  const html = marked.parse(content) as string;

  return (
    <div className="book-content-view">
      <div className="book-content-header">
        <button className="book-content-back" onClick={onBack} title="Back to TOC">
          ← TOC
        </button>
        {heading && (
          <span className="book-content-title">{heading.title}</span>
        )}
      </div>
      <div
        ref={contentRef}
        className="book-content-body"
      >
        {isLoading ? (
          <div className="book-content-loading">Loading…</div>
        ) : (
          <div
            className="book-content-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {onDefine && (
          <SelectionToolbar
            containerRef={contentRef}
            onDefine={onDefine}
          />
        )}
      </div>
    </div>
  );
}
