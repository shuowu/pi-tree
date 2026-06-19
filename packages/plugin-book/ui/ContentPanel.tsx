import { useCallback, useEffect, useRef, useState } from "react";
import { useMermaid, SelectionToolbar } from "@pi-tree/ui";
import { marked } from "marked";
import { BookOpen } from "lucide-react";
import type { ContentPanelProps } from "@pi-tree/ui";
import "./ContentPanel.css";

/** Heading entry in a source's table of contents */
export interface ContentHeading {
  line: number;
  level: number;
  title: string;
}

/** Extended props — data fetching injected by the plugin factory */
export interface BookContentPanelProps extends ContentPanelProps {
  fetchHeadings: (sourceId: string) => Promise<ContentHeading[]>;
  fetchContent: (sourceId: string, startLine: number, endLine: number) => Promise<string>;
}

export function ContentPanel({ sourceId, onDefine, fetchHeadings, fetchContent }: BookContentPanelProps) {
  const [headings, setHeadings] = useState<ContentHeading[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [activeHeading, setActiveHeading] = useState<ContentHeading | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Load headings on mount
  useEffect(() => {
    fetchHeadings(sourceId).then(setHeadings);
  }, [sourceId, fetchHeadings]);

  const handleSelectHeading = useCallback(
    async (heading: ContentHeading, endLine: number) => {
      setActiveHeading(heading);
      setIsLoading(true);
      try {
        const text = await fetchContent(sourceId, heading.line, endLine);
        setContent(text);
        // Scroll content to top
        contentRef.current?.scrollTo(0, 0);
      } catch {
        setContent("Failed to load content.");
      } finally {
        setIsLoading(false);
      }
    },
    [sourceId, fetchContent],
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
        <ContentTOC
          headings={headings}
          onSelect={handleSelectHeading}
        />
      ) : (
        <ContentViewer
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

function ContentTOC({
  headings,
  onSelect,
}: {
  headings: ContentHeading[];
  onSelect: (heading: ContentHeading, endLine: number) => void;
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

function ContentViewer({
  heading,
  content,
  isLoading,
  contentRef,
  onDefine,
  onBack,
}: {
  heading: ContentHeading | null;
  content: string;
  isLoading: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onDefine?: (text: string, context?: string) => void;
  onBack: () => void;
}) {
  const html = marked.parse(content) as string;
  const markdownRef = useRef<HTMLDivElement>(null);

  useMermaid(markdownRef, html);

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
            ref={markdownRef}
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
