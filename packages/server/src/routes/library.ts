import { Hono } from "hono";
import { LibraryService } from "../services/library.js";
import { BookIngestionService } from "../services/book-ingestion.js";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

export const libraryRoutes = new Hono();

const dataPath =
  process.env.DATA_PATH ??
  join(process.env.HOME ?? "~", ".local", "share", "pi-reader");

const library = new LibraryService(undefined, dataPath);
const bookIngestion = new BookIngestionService();

/** List all books in the library */
libraryRoutes.get("/books", async (c) => {
  const books = await library.listBooks();
  return c.json({ books });
});

/** Get a book's cover image */
libraryRoutes.get("/books/:bookId/cover", async (c) => {
  const bookId = c.req.param("bookId");
  const coverPath = await library.getCoverPath(bookId);
  if (!coverPath) return c.json({ error: "Cover not found" }, 404);

  try {
    const fileData = await readFile(coverPath);
    const ext = extname(coverPath).toLowerCase();
    let contentType = "image/jpeg";
    if (ext === ".png") contentType = "image/png";
    else if (ext === ".webp") contentType = "image/webp";
    else if (ext === ".gif") contentType = "image/gif";

    return c.body(fileData, 200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
  } catch (err) {
    return c.json({ error: "Failed to read cover image" }, 500);
  }
});

/** Get a single book's details + outline */
libraryRoutes.get("/books/:bookId", async (c) => {
  const bookId = c.req.param("bookId");
  const book = await library.getBook(bookId);
  if (!book) return c.json({ error: "Book not found" }, 404);
  return c.json(book);
});

/** Get a book's outline (TOC) */
libraryRoutes.get("/books/:bookId/outline", async (c) => {
  const bookId = c.req.param("bookId");
  const outline = await library.getOutline(bookId);
  if (!outline) return c.json({ error: "Outline not found" }, 404);
  return c.json(outline);
});

/** Read a section of the book's markdown */
libraryRoutes.get("/books/:bookId/content", async (c) => {
  const bookId = c.req.param("bookId");
  const startLine = Number(c.req.query("start") ?? 1);
  const endLine = Number(c.req.query("end") ?? startLine + 50);
  const content = await library.readContent(bookId, startLine, endLine);
  if (!content) return c.json({ error: "Content not found" }, 404);
  return c.json({ content, startLine, endLine });
});

/** Get headings from the book's markdown (lightweight TOC with line numbers) */
libraryRoutes.get("/books/:bookId/headings", async (c) => {
  const bookId = c.req.param("bookId");
  const headings = await library.getHeadings(bookId);
  if (!headings) return c.json({ error: "Book not found" }, 404);
  return c.json({ headings });
});

/** Upload a new book */
libraryRoutes.post("/books", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided" }, 400);
    }

    const title = body["title"];
    const author = body["author"];
    if (!title || typeof title !== "string") {
      return c.json({ error: "title is required" }, 400);
    }
    if (!author || typeof author !== "string") {
      return c.json({ error: "author is required" }, 400);
    }

    const yearStr = body["year"];
    const year =
      typeof yearStr === "string" && yearStr.length > 0
        ? parseInt(yearStr, 10)
        : undefined;

    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const filename = (file as File).name ?? "upload.epub";

    const book = await bookIngestion.addBook(buffer, filename, {
      title,
      author,
      year: year && !isNaN(year) ? year : undefined,
    });

    return c.json(book, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/** Delete an uploaded book */
libraryRoutes.delete("/books/:bookId", async (c) => {
  const bookId = c.req.param("bookId");

  try {
    const book = await library.getBook(bookId);
    if (!book) {
      return c.json({ error: "Book not found" }, 404);
    }

    if (book.source === "library") {
      return c.json({ error: "Cannot delete library books" }, 403);
    }

    await bookIngestion.deleteBook(bookId);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

