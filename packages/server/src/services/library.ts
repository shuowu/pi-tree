import type { Book, BookOutline, OutlineEntry } from "@pi-books/shared";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb, books as booksTable, tags as tagsTable, bookTags } from "../db/index.js";
import { BookIngestionService } from "./book-ingestion.js";

/**
 * LibraryService — reads books from a user-configured library path on disk.
 *
 * Set LIBRARY_PATH env var to point at your book collection, or upload books
 * through the UI. Defaults to ~/.local/share/pi-reader/library if not set.
 * Reads the existing folder structure: book/, markdown/, analysis/, notes/.
 */
export class LibraryService {
  private libraryPath: string;
  private userBooksPath: string;
  private ingestion: BookIngestionService;
  private synced = false;

  constructor(libraryPath?: string, dataPath?: string) {
    this.libraryPath =
      libraryPath ??
      process.env.LIBRARY_PATH ??
      join(process.env.HOME ?? "~", ".local", "share", "pi-reader", "library");
    const dp =
      dataPath ??
      process.env.DATA_PATH ??
      join(process.env.HOME ?? "~", ".local", "share", "pi-books");
    this.userBooksPath = join(dp, "books");
    this.ingestion = new BookIngestionService();
  }

  getLibraryPath(): string {
    return this.libraryPath;
  }

  async listBooks(): Promise<Book[]> {
    const entries = await readdir(this.libraryPath, { withFileTypes: true });
    const libraryBooks: Book[] = [];

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
      const hasCover = (
        await this.exists(join(bookPath, "cover.jpg")) ||
        await this.exists(join(bookPath, "cover.jpeg")) ||
        await this.exists(join(bookPath, "cover.png")) ||
        await this.exists(join(bookPath, "cover.webp")) ||
        await this.exists(join(bookPath, "cover.gif"))
      );

      libraryBooks.push({
        id: folderName,
        title: parsed.title,
        author: parsed.author,
        year: parsed.year,
        folderName,
        progress: 0, // TODO: Read from bookmark.md
        hasMarkdown,
        hasOutline,
        hasCover,
        source: "library",
      });
    }

    // Sync library books to DB (idempotent) so they can be tagged
    if (!this.synced) {
      this.syncBooksToDb(libraryBooks);
      this.synced = true;
    }

    const uploadedBooks = await this.ingestion.listUploadedBooks();
    const allBooks = [...libraryBooks, ...uploadedBooks];

    // Attach tags from DB
    const bookIds = allBooks.map((b) => b.id);
    const tagMap = this.getBookTags(bookIds);
    for (const book of allBooks) {
      book.tags = tagMap.get(book.id) ?? [];
    }

    return allBooks;
  }

  /**
   * Search and filter books by query text and/or tags.
   */
  async searchBooks(query?: string, filterTags?: string[]): Promise<Book[]> {
    let books = await this.listBooks();

    if (query) {
      const q = query.toLowerCase();
      books = books.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q),
      );
    }

    if (filterTags && filterTags.length > 0) {
      books = books.filter((b) => {
        const bookTagSet = new Set(b.tags ?? []);
        return filterTags.every((t) => bookTagSet.has(t));
      });
    }

    return books;
  }

  // ---------------------------------------------------------------------------
  // Book sync — upsert library books into DB for tagging
  // ---------------------------------------------------------------------------

  private syncBooksToDb(libraryBooks: Book[]): void {
    const db = getDb();
    const now = new Date().toISOString();

    for (const book of libraryBooks) {
      db.insert(booksTable)
        .values({
          id: book.id,
          title: book.title,
          author: book.author,
          year: book.year,
          source: "library",
          sourceFormat: "library",
          status: "ready",
          originalFilename: book.folderName,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  // ---------------------------------------------------------------------------
  // Tag management
  // ---------------------------------------------------------------------------

  /**
   * Get tags for a list of book IDs. Returns a map of bookId → tag names.
   */
  getBookTags(bookIds: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (bookIds.length === 0) return result;

    const db = getDb();
    // Use raw SQL for efficient join query
    const rows = db.all<{ book_id: string; name: string }>(
      sql`SELECT bt.book_id, t.name
          FROM book_tags bt
          JOIN tags t ON t.id = bt.tag_id
          WHERE bt.book_id IN (${sql.join(
            bookIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
    );

    for (const row of rows) {
      const existing = result.get(row.book_id);
      if (existing) {
        existing.push(row.name);
      } else {
        result.set(row.book_id, [row.name]);
      }
    }
    return result;
  }

  /**
   * Add a tag to a book. Creates the tag if it doesn't exist.
   */
  async addTag(bookId: string, tagName: string): Promise<void> {
    const db = getDb();
    const name = tagName.toLowerCase().trim();
    if (!name) return;

    // Ensure the book exists in DB (sync if needed)
    if (!this.synced) {
      await this.listBooks();
    }

    // Create tag if it doesn't exist
    db.insert(tagsTable)
      .values({ name, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();

    // Get the tag id
    const tag = db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.name, name))
      .get();
    if (!tag) return;

    // Insert junction row
    db.run(
      sql`INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (${bookId}, ${tag.id})`,
    );
  }

  /**
   * Remove a tag from a book. Cleans up orphaned tags.
   */
  async removeTag(bookId: string, tagName: string): Promise<void> {
    const db = getDb();
    const name = tagName.toLowerCase().trim();

    const tag = db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.name, name))
      .get();
    if (!tag) return;

    // Remove junction row
    db.run(
      sql`DELETE FROM book_tags WHERE book_id = ${bookId} AND tag_id = ${tag.id}`,
    );

    // Clean up orphaned tag (no books reference it)
    const usage = db
      .select({ count: sql<number>`count(*)` })
      .from(bookTags)
      .where(eq(bookTags.tagId, tag.id))
      .get();
    if (usage && usage.count === 0) {
      db.delete(tagsTable).where(eq(tagsTable.id, tag.id)).run();
    }
  }

  /**
   * List all unique tag names.
   */
  listTags(): string[] {
    const db = getDb();
    const rows = db
      .select({ name: tagsTable.name })
      .from(tagsTable)
      .orderBy(tagsTable.name)
      .all();
    return rows.map((r) => r.name);
  }

  async getBook(bookId: string): Promise<Book | null> {
    const books = await this.listBooks();
    return books.find((b) => b.id === bookId) ?? null;
  }

  async getCoverPath(bookId: string): Promise<string | null> {
    const searchPaths = [
      join(this.libraryPath, bookId),
      join(this.userBooksPath, bookId),
    ];
    const extensions = ["jpg", "jpeg", "png", "webp", "gif"];
    for (const basePath of searchPaths) {
      for (const ext of extensions) {
        const coverPath = join(basePath, `cover.${ext}`);
        if (await this.exists(coverPath)) {
          return coverPath;
        }
      }
    }
    return null;
  }

  async getOutline(bookId: string): Promise<BookOutline | null> {
    // 1. Try toc.json first (structured, zero-parsing)
    const tocJson = await this.loadTocJson(bookId);
    if (tocJson) return tocJson;

    // 2. Fallback: parse outline.md (Navigation Map or heading extraction)
    const candidatePaths = [
      join(this.libraryPath, bookId, "analysis", "outline.md"),
      join(this.userBooksPath, bookId, "analysis", "outline.md"),
    ];

    for (const outlinePath of candidatePaths) {
      try {
        const content = await readFile(outlinePath, "utf-8");
        return this.parseOutline(bookId, content);
      } catch {
        // Try next path
      }
    }
    return null;
  }

  /**
   * Load a structured toc.json if it exists.
   * This is the preferred source — emitted by the book-outline skill as clean JSON.
   */
  private async loadTocJson(bookId: string): Promise<BookOutline | null> {
    const candidatePaths = [
      join(this.libraryPath, bookId, "analysis", "toc.json"),
      join(this.userBooksPath, bookId, "analysis", "toc.json"),
    ];

    for (const tocPath of candidatePaths) {
      try {
        const raw = await readFile(tocPath, "utf-8");
        const data = JSON.parse(raw) as Array<{
          line: number;
          level: number;
          title: string;
        }>;

        if (!Array.isArray(data) || data.length === 0) continue;

        const entries: OutlineEntry[] = data.map((d) => ({
          line: d.line,
          level: d.level,
          title: d.title,
          children: [],
        }));

        const root = this.buildOutlineTree(entries);

        // Try to get summary from outline.md if it exists
        let summary = "";
        const outlineCandidates = [
          join(this.libraryPath, bookId, "analysis", "outline.md"),
          join(this.userBooksPath, bookId, "analysis", "outline.md"),
        ];
        for (const outlinePath of outlineCandidates) {
          try {
            const outlineContent = await readFile(outlinePath, "utf-8");
            summary = this.extractSummary(outlineContent.split("\n"));
            break;
          } catch {
            // Try next
          }
        }

        return { bookId, summary, entries: root };
      } catch {
        // Try next path
      }
    }
    return null;
  }

  async readContent(
    bookId: string,
    startLine: number,
    endLine: number,
  ): Promise<string | null> {
    const candidateDirs = [
      join(this.libraryPath, bookId, "markdown"),
      join(this.userBooksPath, bookId, "markdown"),
    ];

    for (const mdDir of candidateDirs) {
      try {
        const files = await readdir(mdDir);
        const mdFile = files.find((f) => f.endsWith(".md"));
        if (!mdFile) continue;

        const content = await readFile(join(mdDir, mdFile), "utf-8");
        const lines = content.split("\n");
        return lines.slice(startLine - 1, endLine).join("\n");
      } catch {
        // Try next path
      }
    }
    return null;
  }

  /**
   * Extract headings as a lightweight TOC.
   *
   * Priority:
   *  1. toc.json (structured, emitted by book-outline skill)
   *  2. AI-generated Navigation Map from outline.md (clean titles, correct lines)
   *  3. Regex extraction from raw markdown (fallback)
   */
  async getHeadings(
    bookId: string,
  ): Promise<Array<{ line: number; level: number; title: string }> | null> {
    // 1. Try outline's Navigation Map first (AI-cleaned, reliable)
    const outline = await this.getOutline(bookId);
    if (outline && outline.entries.length > 0) {
      return this.flattenOutline(outline.entries);
    }

    // 2. Fallback: regex from raw markdown
    return this.extractHeadingsFromMarkdown(bookId);
  }

  /**
   * Flatten an OutlineEntry tree into a flat heading list.
   */
  private flattenOutline(
    entries: OutlineEntry[],
  ): Array<{ line: number; level: number; title: string }> {
    const result: Array<{ line: number; level: number; title: string }> = [];

    const walk = (nodes: OutlineEntry[]) => {
      for (const node of nodes) {
        result.push({ line: node.line, level: node.level, title: node.title });
        if (node.children.length > 0) walk(node.children);
      }
    };

    walk(entries);
    // Sort by line number to ensure correct order after tree flattening
    result.sort((a, b) => a.line - b.line);
    return result;
  }

  /**
   * Regex-based heading extraction from raw markdown.
   * Used as fallback when no outline Navigation Map is available.
   */
  private async extractHeadingsFromMarkdown(
    bookId: string,
  ): Promise<Array<{ line: number; level: number; title: string }> | null> {
    const candidateDirs = [
      join(this.libraryPath, bookId, "markdown"),
      join(this.userBooksPath, bookId, "markdown"),
    ];

    for (const mdDir of candidateDirs) {
      try {
        const files = await readdir(mdDir);
        const mdFile = files.find((f) => f.endsWith(".md"));
        if (!mdFile) continue;

        const content = await readFile(join(mdDir, mdFile), "utf-8");
        const lines = content.split("\n");
        const headings: Array<{ line: number; level: number; title: string }> = [];

        let inCodeBlock = false;
        for (let i = 0; i < lines.length; i++) {
          // Skip lines inside fenced code blocks
          if (/^(`{3,}|~{3,})/.test(lines[i])) {
            inCodeBlock = !inCodeBlock;
            continue;
          }
          if (inCodeBlock) continue;

          const match = lines[i].match(/^(#{1,6})\s+(.+)/);
          if (match) {
            const title = this.cleanHeadingTitle(match[2]);
            if (title.length > 0 && !this.isNoiseHeading(title)) {
              headings.push({
                line: i + 1,
                level: match[1].length,
                title,
              });
            }
          }
        }

        return headings;
      } catch {
        // Try next path
      }
    }
    return null;
  }

  /**
   * Clean conversion artifacts from heading text.
   * Handles Pandoc/Calibre/Sigil markup that survives ebook-to-markdown conversion.
   */
  private cleanHeadingTitle(raw: string): string {
    return (
      raw
        // Remove Pandoc span/id markers: []{#id .class}  or  [text]{.class}
        .replace(/\[([^\]]*)\]\{[^}]+\}/g, "$1")
        // Remove trailing {.class-name} attributes
        .replace(/\s*\{[^}]+\}\s*$/g, "")
        // Remove empty [] markers
        .replace(/\[\]\s*/g, "")
        // Remove bold **markers**
        .replace(/\*\*/g, "")
        // Remove inline HTML tags like <big>, </big>
        .replace(/<[^>]+>/g, "")
        // Remove leading bullet markers like ◆
        .replace(/^[◆●■►▸▪]\s*/g, "")
        // Remove escaped pipe: 7\|
        .replace(/\\\|/g, "|")
        // Collapse whitespace (fullwidth + regular spaces)
        .replace(/[\s\u3000]+/g, " ")
        .trim()
    );
  }

  /**
   * Filter out known non-content headings (ads, metadata, noise).
   */
  private isNoiseHeading(title: string): boolean {
    const NOISE_PATTERNS = [
      /^continue reading/i,
      /^读累了/,
      /^index$/i,
      /^copyright$/i,
      /^isbn/i,
    ];
    return NOISE_PATTERNS.some((p) => p.test(title));
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

  /**
   * Parse a book's outline.md, preferring the Navigation Map code block
   * (L-prefixed line entries) produced by the book-outline skill.
   * Falls back to extracting headings from the outline markdown itself.
   */
  private parseOutline(bookId: string, content: string): BookOutline {
    const lines = content.split("\n");

    // 1. Try to extract from Navigation Map code block (L<line> format)
    const navMapEntries = this.parseNavigationMap(lines);

    if (navMapEntries.length > 0) {
      const root = this.buildOutlineTree(navMapEntries);
      return {
        bookId,
        summary: this.extractSummary(lines),
        entries: root,
      };
    }

    // 2. Fallback: extract headings from the outline markdown itself
    const entries: OutlineEntry[] = [];
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

    const root = this.buildOutlineTree(entries);
    return {
      bookId,
      summary: this.extractSummary(lines),
      entries: root,
    };
  }

  /**
   * Parse the Navigation Map code block from outline.md.
   * Looks for a fenced code block after a "Navigation Map" heading,
   * containing lines like: L156   ## Part 1: Title (L256–L7207)
   */
  private parseNavigationMap(lines: string[]): OutlineEntry[] {
    const entries: OutlineEntry[] = [];

    // Find the Navigation Map section
    let navMapHeaderIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,3}\s+(Navigation Map|导航图)/i.test(lines[i])) {
        navMapHeaderIdx = i;
        break;
      }
    }
    if (navMapHeaderIdx === -1) return [];

    // Find the code block after the header
    let inCodeBlock = false;
    for (let i = navMapHeaderIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith("```")) {
        if (inCodeBlock) break; // closing fence — done
        inCodeBlock = true;
        continue;
      }

      if (!inCodeBlock) continue;

      // Parse: L156   ## Part 1: Title (L256–L7207)
      const match = trimmed.match(/^L(\d+)\s+(#{1,6})\s+(.+)/);
      if (match) {
        const title = match[3]
          // Remove trailing line-range annotations like (L256–L7207)
          .replace(/\s*\(L\d+[–\-]L\d+\)\s*$/, "")
          .trim();

        if (title.length > 0) {
          entries.push({
            line: parseInt(match[1], 10),
            level: match[2].length,
            title,
            children: [],
          });
        }
      }
    }

    return entries;
  }

  /**
   * Extract the one-line summary from outline.md content.
   */
  private extractSummary(lines: string[]): string {
    let inSummary = false;
    for (const line of lines) {
      if (/^#{1,3}\s+One-Line Summary/i.test(line)) {
        inSummary = true;
        continue;
      }
      if (inSummary) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          return trimmed;
        }
        if (trimmed.startsWith("#")) break; // next section
      }
    }
    return "";
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
