import { readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { getParser } from "../parsers/index.js";
import type { SourceService } from "@pi-tree/plugin-sdk";

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the original uploaded file for a source.
 * Looks for files named `original.*` in the source directory.
 */
export async function findOriginalFile(
  sourceDir: string,
): Promise<{ path: string; ext: string } | null> {
  try {
    const entries = await readdir(sourceDir);
    for (const entry of entries) {
      if (entry.startsWith("original")) {
        const ext = extname(entry).toLowerCase();
        return { path: join(sourceDir, entry), ext };
      }
    }
  } catch {
    // directory might not exist
  }
  return null;
}

/**
 * Extract headings from markdown content for toc.json generation.
 * Matches standard markdown headings and plain-text chapter/section patterns.
 */
export function extractHeadings(
  markdown: string,
): Array<{ line: number; level: number; title: string }> {
  const lines = markdown.split("\n");
  const headings: Array<{ line: number; level: number; title: string }> = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (/^(`{3,}|~{3,})/.test(rawLine)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // 1. Standard markdown headings
    const mdMatch = rawLine.match(/^(#{1,6})\s+(.+)/);
    if (mdMatch) {
      let title = mdMatch[2]
        .replace(/\[\]\{#[^}]+\}/g, "")
        .replace(/\{[^}]+\}/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/[\*\_◆]+/g, "")
        .trim();
      if (title.length > 0) {
        headings.push({ line: i + 1, level: mdMatch[1].length, title });
      }
      continue;
    }

    // 2. Plain-text Chapter headings, e.g. "Chapter 3"
    const chapterMatch = rawLine.match(/^Chapter\s+(\d+)\s*$/i);
    if (chapterMatch) {
      let title = "";
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (nextLine.length > 0) {
          title = nextLine;
          break;
        }
      }
      const cleanTitle = `Chapter ${chapterMatch[1]}${title ? " – " + title : ""}`;
      headings.push({ line: i + 1, level: 1, title: cleanTitle });
      continue;
    }

    // 3. Plain-text Section headings, e.g. "3.1 Introduction: ..."
    const sectionMatch = rawLine.match(/^(\d+)\.(\d+)\s+(.+)/);
    if (sectionMatch) {
      const cleanTitle = `${sectionMatch[1]}.${sectionMatch[2]} ${sectionMatch[3].trim()}`;
      headings.push({ line: i + 1, level: 2, title: cleanTitle });
      continue;
    }

    // 4. Plain-text Introduction / Conclusion / Summary / References
    if (/^(Introduction|Conclusion|Summary|References)$/i.test(rawLine)) {
      headings.push({ line: i + 1, level: 1, title: rawLine });
      continue;
    }
  }

  return headings;
}

export interface ProcessBookDeps {
  sourcesBasePath: string;
  sources: Pick<SourceService, "get" | "update">;
}

export interface ProcessBookResult {
  sourceId: string;
  title: string;
  author: string;
  lines: number;
  headings: number;
  hasCover: boolean;
  alreadyProcessed: boolean;
}

/**
 * Process an uploaded ebook file into markdown.
 * Returns structured result (no Pi SDK types — pure data).
 */
export async function processBook(
  sourceId: string,
  deps: ProcessBookDeps,
): Promise<ProcessBookResult> {
  const { sourcesBasePath, sources } = deps;

  // 1. Validate source exists
  const row = sources.get(sourceId);
  if (!row) {
    throw new Error(`Source '${sourceId}' not found in database.`);
  }

  const sourceDir = join(sourcesBasePath, sourceId);
  const markdownDir = join(sourceDir, "markdown");
  const analysisDir = join(sourceDir, "analysis");

  // 2. Check if markdown already exists (idempotent — skip parsing)
  if (await exists(markdownDir)) {
    const files = await readdir(markdownDir);
    const hasMd = files.some((f) => f.endsWith(".md"));
    if (hasMd) {
      // Already parsed — just make sure status is right
      sources.update(sourceId, { status: "ready" });
      return {
        sourceId,
        title: row.title,
        author: row.author,
        lines: 0,
        headings: 0,
        hasCover: false,
        alreadyProcessed: true,
      };
    }
  }

  // 3. Find original file
  const original = await findOriginalFile(sourceDir);
  if (!original) {
    throw new Error(
      `No original file found for source '${sourceId}' in ${sourceDir}. ` +
        `Expected a file named 'original.*' (e.g. original.epub, original.pdf).`,
    );
  }

  // 4. Get parser
  const parser = getParser(`file${original.ext}`);
  if (!parser) {
    throw new Error(
      `No parser available for file type '${original.ext}'. ` +
        `Supported formats: .epub, .mobi, .azw, .azw3, .pdf`,
    );
  }

  // 5. Update status to processing
  sources.update(sourceId, { status: "processing" });

  // 6. Parse the file
  const result = await parser.parse(original.path);

  // 7. Write markdown
  await mkdir(markdownDir, { recursive: true });
  const mdPath = join(markdownDir, `${sourceId}.md`);
  await writeFile(mdPath, result.markdown, "utf-8");

  // 8. Write cover if present
  if (result.cover) {
    const coverPath = join(sourceDir, `cover${result.cover.ext}`);
    await writeFile(coverPath, result.cover.data);
  }

  // 9. Generate candidate toc.json from headings
  await mkdir(analysisDir, { recursive: true });
  const headings = extractHeadings(result.markdown);
  await writeFile(
    join(analysisDir, "toc.json"),
    JSON.stringify(headings, null, 2),
    "utf-8",
  );

  // 10. Update DB with metadata from parsed file and mark ready
  const title = result.metadata.title ?? row.title;
  const author = result.metadata.author ?? row.author;
  sources.update(sourceId, {
    status: "ready",
    error: null,
    title,
    author,
    year: result.metadata.year ?? row.year ?? undefined,
  });

  const lineCount = result.markdown.split("\n").length;
  return {
    sourceId,
    title,
    author,
    lines: lineCount,
    headings: headings.length,
    hasCover: !!result.cover,
    alreadyProcessed: false,
  };
}

