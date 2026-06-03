import type { Book, BookOutline, OutlineEntry } from "@pi-reader/shared";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * LibraryService — reads books from the pi-books library on disk.
 *
 * Points at a configurable library path (defaults to ~/repos/pi-books/library).
 * Reads the existing folder structure: book/, markdown/, analysis/, notes/.
 */
export class LibraryService {
  private libraryPath: string;

  constructor(libraryPath?: string) {
    this.libraryPath =
      libraryPath ??
      process.env.LIBRARY_PATH ??
      join(process.env.HOME ?? "~", "repos", "pi-books", "library");
  }

  async listBooks(): Promise<Book[]> {
    const entries = await readdir(this.libraryPath, { withFileTypes: true });
    const books: Book[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const folderName = entry.name;
      const parsed = this.parseFolderName(folderName);
      if (!parsed) continue;

      const bookPath = join(this.libraryPath, folderName);

      const hasMarkdown = await this.exists(join(bookPath, "markdown"));
      const hasOutline = await this.exists(
        join(bookPath, "analysis", "outline.md"),
      );

      books.push({
        id: folderName,
        title: parsed.title,
        author: parsed.author,
        year: parsed.year,
        folderName,
        progress: 0, // TODO: Read from bookmark.md
        hasMarkdown,
        hasOutline,
      });
    }

    return books;
  }

  async getBook(bookId: string): Promise<Book | null> {
    const books = await this.listBooks();
    return books.find((b) => b.id === bookId) ?? null;
  }

  async getOutline(bookId: string): Promise<BookOutline | null> {
    const outlinePath = join(
      this.libraryPath,
      bookId,
      "analysis",
      "outline.md",
    );

    try {
      const content = await readFile(outlinePath, "utf-8");
      return this.parseOutline(bookId, content);
    } catch {
      return null;
    }
  }

  async readContent(
    bookId: string,
    startLine: number,
    endLine: number,
  ): Promise<string | null> {
    const mdDir = join(this.libraryPath, bookId, "markdown");

    try {
      const files = await readdir(mdDir);
      const mdFile = files.find((f) => f.endsWith(".md"));
      if (!mdFile) return null;

      const content = await readFile(join(mdDir, mdFile), "utf-8");
      const lines = content.split("\n");
      return lines.slice(startLine - 1, endLine).join("\n");
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseFolderName(
    name: string,
  ): { title: string; author: string; year: number } | null {
    // Pattern: Title_Author_Year  or  Title Author_Author_Year
    const parts = name.split("_");
    if (parts.length < 3) return null;

    const year = parseInt(parts[parts.length - 1], 10);
    if (isNaN(year)) return null;

    const author = parts[parts.length - 2];
    const title = parts.slice(0, -2).join(" ");

    return { title, author, year };
  }

  private parseOutline(bookId: string, content: string): BookOutline {
    // Basic outline parser — extracts headings and line numbers
    const lines = content.split("\n");
    const entries: OutlineEntry[] = [];

    // TODO: Parse the Navigation Map section for line-number anchored entries
    // For now, extract headings from the outline itself
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (match) {
        entries.push({
          line: i + 1,
          level: match[1].length,
          title: match[2].trim(),
          children: [],
        });
      }
    }

    // Build hierarchy from flat list
    const root = this.buildOutlineTree(entries);

    return {
      bookId,
      summary: "", // TODO: Extract from outline content
      entries: root,
    };
  }

  private buildOutlineTree(entries: OutlineEntry[]): OutlineEntry[] {
    if (entries.length === 0) return [];

    const result: OutlineEntry[] = [];
    const stack: OutlineEntry[] = [];

    for (const entry of entries) {
      while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        result.push(entry);
      } else {
        stack[stack.length - 1].children.push(entry);
      }

      stack.push(entry);
    }

    return result;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
