import type { Book } from "@pi-books/shared";
import { eq, sql } from "drizzle-orm";
import { mkdir, writeFile, rm, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { getDb, books } from "../db/index.js";
import { getParser } from "../parsers/index.js";

const dataPath =
  process.env.DATA_PATH ??
  join(process.env.HOME ?? "~", ".local", "share", "pi-books");

const booksBasePath = join(dataPath, "books");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class BookIngestionService {
  async addBook(
    file: Buffer,
    filename: string,
    meta: { title: string; author: string; year?: number },
  ): Promise<Book> {
    const db = getDb();
    const ext = extname(filename).toLowerCase();

    // Generate bookId
    const parts = [meta.title, meta.author];
    if (meta.year) parts.push(String(meta.year));
    let baseId = slugify(parts.join("-"));
    let bookId = baseId;
    let suffix = 1;

    // Check for collision
    while (true) {
      const existing = db.select().from(books).where(eq(books.id, bookId)).get();
      if (!existing) break;
      suffix++;
      bookId = `${baseId}-${suffix}`;
    }

    // Create directory structure
    const bookDir = join(booksBasePath, bookId);
    const markdownDir = join(bookDir, "markdown");
    await mkdir(markdownDir, { recursive: true });

    // Save original file
    const originalPath = join(bookDir, `original${ext}`);
    await writeFile(originalPath, file);

    // Insert DB row
    const now = new Date().toISOString();
    db.insert(books)
      .values({
        id: bookId,
        title: meta.title,
        author: meta.author,
        year: meta.year ?? null,
        sourceFormat: ext.slice(1),
        status: "pending",
        originalFilename: filename,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Process in background (don't await to return immediately)
    this.processBook(bookId).catch((err) => {
      console.error(`[book-ingestion] Failed to process ${bookId}:`, err);
    });

    return {
      id: bookId,
      title: meta.title,
      author: meta.author,
      year: meta.year ?? 0,
      folderName: bookId,
      progress: 0,
      hasMarkdown: false,
      hasOutline: false,
      hasCover: false,
      source: "upload",
      status: "pending",
    };
  }

  async processBook(bookId: string): Promise<void> {
    const db = getDb();
    const row = db.select().from(books).where(eq(books.id, bookId)).get();
    if (!row) throw new Error(`Book ${bookId} not found in DB`);

    const now = () => new Date().toISOString();

    // Update status to processing
    db.update(books)
      .set({ status: "processing", updatedAt: now() })
      .where(eq(books.id, bookId))
      .run();

    const bookDir = join(booksBasePath, bookId);
    const originalPath = join(bookDir, `original.${row.sourceFormat}`);

    try {
      const parser = getParser(row.originalFilename);
      if (!parser) {
        throw new Error(`No parser for format: ${row.sourceFormat}`);
      }

      const result = await parser.parse(originalPath);

      // Write markdown
      const mdPath = join(bookDir, "markdown", `${bookId}.md`);
      await writeFile(mdPath, result.markdown, "utf-8");

      // Write cover if present
      if (result.cover) {
        const coverPath = join(bookDir, `cover${result.cover.ext}`);
        await writeFile(coverPath, result.cover.data);
      }

      // Update DB with success
      db.update(books)
        .set({
          status: "ready",
          error: null,
          title: result.metadata.title ?? row.title,
          author: result.metadata.author ?? row.author,
          year: result.metadata.year ?? row.year,
          updatedAt: now(),
        })
        .where(eq(books.id, bookId))
        .run();

      console.log(`[book-ingestion] Successfully processed ${bookId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.update(books)
        .set({ status: "failed", error: message, updatedAt: now() })
        .where(eq(books.id, bookId))
        .run();
      console.error(`[book-ingestion] Failed to process ${bookId}:`, message);
    }
  }

  async deleteBook(bookId: string): Promise<void> {
    const db = getDb();

    // Delete DB row
    db.delete(books).where(eq(books.id, bookId)).run();

    // Delete directory
    const bookDir = join(booksBasePath, bookId);
    await rm(bookDir, { recursive: true, force: true });
  }

  async listUploadedBooks(): Promise<Book[]> {
    const db = getDb();
    const rows = db.select().from(books).where(
      sql`${books.source} != 'library' OR ${books.source} IS NULL`
    ).all();
    const result: Book[] = [];

    for (const row of rows) {
      const bookDir = join(booksBasePath, row.id);

      const hasMarkdown = await exists(join(bookDir, "markdown"));
      const hasOutline =
        (await exists(join(bookDir, "analysis", "outline.md"))) ||
        (await exists(join(bookDir, "analysis", "toc.json")));

      let hasCover = false;
      for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
        if (await exists(join(bookDir, `cover.${ext}`))) {
          hasCover = true;
          break;
        }
      }

      result.push({
        id: row.id,
        title: row.title,
        author: row.author,
        year: row.year ?? 0,
        folderName: row.id,
        progress: 0,
        hasMarkdown,
        hasOutline,
        hasCover,
        source: "upload",
        status: row.status as Book["status"],
        error: row.error ?? undefined,
      });
    }

    return result;
  }

  getUploadedBookPath(bookId: string): string {
    return join(booksBasePath, bookId);
  }
}
