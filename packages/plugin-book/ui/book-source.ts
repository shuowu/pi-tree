/**
 * Chapter sources for the book reader. A book is a list of chapter keys in
 * reading order, a table of contents pointing at `key#fragment`, and a loader
 * that turns a chapter into safe HTML. EPUBs read chapters straight from the
 * archive; books without one are split from their converted markdown.
 */

import { marked } from "marked";
import { processChapter, type ProcessedChapter } from "./epub-html.js";

export interface TocEntry {
  title: string;
  level: number;
  /** Chapter key, optionally with a #fragment */
  href: string;
}

export interface BookChapters {
  title?: string;
  /** Chapter keys in reading order */
  spine: string[];
  toc: TocEntry[];
  loadChapter: (key: string) => Promise<ProcessedChapter>;
}

/** EPUB structure served by /api/book/:id/epub */
export interface EpubInfo {
  title?: string;
  /** Zip paths of the spine documents */
  spine: string[];
  /** hrefs are zip paths */
  toc: TocEntry[];
}

export function epubChapters(
  info: EpubInfo,
  fetchText: (path: string) => Promise<string>,
  fileUrl: (path: string) => string,
): BookChapters {
  return {
    ...info,
    loadChapter: async (path) => processChapter(await fetchText(path), path, fileUrl),
  };
}

/** Heading in a source's converted markdown (line is 1-based) */
export interface MarkdownHeading {
  line: number;
  level: number;
  title: string;
}

/** Past the last line of any book — the content route clamps the range */
const END_OF_BOOK = 1_000_000_000;

const mdKey = (line: number) => `md-${line}`;
const headingId = (line: number) => `h${line}`;

/** Above this average, chapters split at the next heading level (parts → chapters) */
const MAX_AVG_CHAPTER_LINES = 800;

/**
 * Heading level to split chapters at: the shallowest level that occurs more
 * than once (a lone level-1 heading is usually the book title), going deeper
 * while that leaves chapters very long — outlines often put parts at level 1.
 */
function splitLevelFor(sorted: MarkdownHeading[], levels: number[]): number {
  const repeating = levels.filter((l) => sorted.filter((h) => h.level === l).length > 1);
  if (repeating.length === 0) return levels[0];
  const span = sorted[sorted.length - 1].line;
  for (const level of repeating) {
    const chapters = sorted.filter((h) => h.level <= level).length;
    if (span / chapters <= MAX_AVG_CHAPTER_LINES) return level;
  }
  return repeating[repeating.length - 1];
}

/**
 * Split a markdown book into chapters at its headings (see splitLevelFor).
 * Text before the first chapter joins it. Deeper headings become fragment
 * links within their chapter.
 */
export function markdownChapters(
  headings: MarkdownHeading[],
  fetchLines: (start: number, end: number) => Promise<string>,
): BookChapters {
  const sorted = [...headings].sort((a, b) => a.line - b.line);
  const levels = [...new Set(sorted.map((h) => h.level))].sort((a, b) => a - b);
  const splitLevel = splitLevelFor(sorted, levels);

  const starts = [...new Set(sorted.filter((h) => h.level <= splitLevel).map((h) => h.line))];
  // Front matter joins the first chapter
  if (starts.length === 0) starts.push(1);
  else starts[0] = 1;
  const spine = starts.map(mdKey);

  const chapterStartFor = (line: number) => {
    let start = starts[0];
    for (const s of starts) if (s <= line) start = s;
    return start;
  };

  const minLevel = levels[0] ?? 1;
  const toc: TocEntry[] = sorted
    .filter((h) => h.level <= minLevel + 2)
    .map((h) => {
      const start = chapterStartFor(h.line);
      const href = h.line === start ? mdKey(start) : `${mdKey(start)}#${headingId(h.line)}`;
      return { title: h.title, level: h.level, href };
    });

  return {
    spine,
    toc,
    loadChapter: async (key) => {
      const i = spine.indexOf(key);
      if (i < 0) throw new Error(`Unknown chapter ${key}`);
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] - 1 : END_OF_BOOK;
      const lines = (await fetchLines(start, end)).split("\n");
      // Anchor each heading inside the chapter so TOC fragments can scroll to it
      for (const h of sorted) {
        if (h.line <= start || h.line > end) continue;
        const idx = h.line - start;
        if (idx < lines.length) lines[idx] = `<a id="${headingId(h.line)}"></a>\n\n${lines[idx]}`;
      }
      const html = marked.parse(lines.join("\n"), { async: false });
      // Same sanitizer as EPUB chapters; there are no archive files to resolve
      return processChapter(html, "", (path) => path);
    },
  };
}
