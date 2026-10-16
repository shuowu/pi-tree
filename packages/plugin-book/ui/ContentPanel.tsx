import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import type { ContentPanelProps } from "@pi-tree/ui";
import { BookReader } from "./BookReader.js";
import {
  epubChapters,
  markdownChapters,
  type BookChapters,
  type EpubInfo,
  type MarkdownHeading,
} from "./book-source.js";
import "./ContentPanel.css";

/** Extended props — data fetching injected by the plugin factory */
export interface BookContentPanelProps extends ContentPanelProps {
  fetchHeadings: (sourceId: string) => Promise<MarkdownHeading[]>;
  fetchContent: (sourceId: string, startLine: number, endLine: number) => Promise<string>;
  /** EPUB structure for the native reader; null when the source isn't an EPUB */
  fetchEpubInfo: (sourceId: string) => Promise<EpubInfo | null>;
  fetchEpubText: (sourceId: string, path: string) => Promise<string>;
  epubFileUrl: (sourceId: string, path: string) => string;
}

/**
 * The Book panel: one reader for every book. Chapters come from the EPUB when
 * the source has one, otherwise from its converted markdown split at headings.
 */
export function ContentPanel(props: BookContentPanelProps) {
  const { sourceId, onDefine, onQuote, fetchHeadings, fetchContent, fetchEpubInfo, fetchEpubText, epubFileUrl } =
    props;
  // undefined = still loading; null = no readable content
  const [book, setBook] = useState<BookChapters | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setBook(undefined);
    (async (): Promise<BookChapters | null> => {
      const epub = await fetchEpubInfo(sourceId).catch(() => null);
      if (epub && epub.spine.length > 0) {
        return epubChapters(
          epub,
          (path) => fetchEpubText(sourceId, path),
          (path) => epubFileUrl(sourceId, path),
        );
      }
      const headings = await fetchHeadings(sourceId).catch(() => []);
      if (headings.length === 0) return null;
      return markdownChapters(headings, (start, end) => fetchContent(sourceId, start, end));
    })().then((b) => !cancelled && setBook(b));
    return () => {
      cancelled = true;
    };
  }, [sourceId, fetchEpubInfo, fetchEpubText, epubFileUrl, fetchHeadings, fetchContent]);

  if (book === undefined) return <div className="book-panel" />;
  if (book === null) {
    return (
      <div className="book-panel-empty">
        <BookOpen size={28} className="book-panel-empty-icon" strokeWidth={1.5} />
        <p>No book content available</p>
      </div>
    );
  }
  return <BookReader key={sourceId} sourceId={sourceId} book={book} onDefine={onDefine} onQuote={onQuote} />;
}
