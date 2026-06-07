import { Hono } from "hono";
import { LibraryService } from "../services/library.js";
import { BookIngestionService } from "../services/book-ingestion.js";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { JobQueueService } from "../services/job-queue.js";

export const libraryRoutes = new Hono();

let _library: LibraryService | null = null;
let _bookIngestion: BookIngestionService | null = null;

function getLibrary(): LibraryService {
  if (!_library) {
    const dataPath =
      process.env.DATA_PATH ??
      join(process.env.HOME ?? "~", ".local", "share", "pi-books");
    _library = new LibraryService(undefined, dataPath);
  }
  return _library;
}

function getBookIngestion(): BookIngestionService {
  if (!_bookIngestion) {
    _bookIngestion = new BookIngestionService();
  }
  return _bookIngestion;
}

/** @internal — used by tests to reset singletons */
export function _resetLibraryServices(): void {
  _library = null;
  _bookIngestion = null;
}

/** List all books in the library (with optional search/tag filter) */
libraryRoutes.get("/books", async (c) => {
  const search = c.req.query("search");
  const tagsParam = c.req.query("tags");
  const filterTags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;

  const books =
    search || (filterTags && filterTags.length > 0)
      ? await getLibrary().searchBooks(search, filterTags)
      : await getLibrary().listBooks();
  return c.json({ books });
});

/** Get a book's cover image */
libraryRoutes.get("/books/:bookId/cover", async (c) => {
  const bookId = c.req.param("bookId");
  const coverPath = await getLibrary().getCoverPath(bookId);
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
  const book = await getLibrary().getBook(bookId);
  if (!book) return c.json({ error: "Book not found" }, 404);
  return c.json(book);
});

/** Get a book's outline (TOC) */
libraryRoutes.get("/books/:bookId/outline", async (c) => {
  const bookId = c.req.param("bookId");
  const outline = await getLibrary().getOutline(bookId);
  if (!outline) return c.json({ error: "Outline not found" }, 404);
  return c.json(outline);
});

/** Read a section of the book's markdown */
libraryRoutes.get("/books/:bookId/content", async (c) => {
  const bookId = c.req.param("bookId");
  const startLine = Number(c.req.query("start") ?? 1);
  const endLine = Number(c.req.query("end") ?? startLine + 50);
  const content = await getLibrary().readContent(bookId, startLine, endLine);
  if (!content) return c.json({ error: "Content not found" }, 404);
  return c.json({ content, startLine, endLine });
});

/** Get headings from the book's markdown (lightweight TOC with line numbers) */
libraryRoutes.get("/books/:bookId/headings", async (c) => {
  const bookId = c.req.param("bookId");
  const headings = await getLibrary().getHeadings(bookId);
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

    const book = await getBookIngestion().addBook(buffer, filename, {
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
    const book = await getLibrary().getBook(bookId);
    if (!book) {
      return c.json({ error: "Book not found" }, 404);
    }

    if (book.source === "library") {
      return c.json({ error: "Cannot delete library books" }, 403);
    }

    await getBookIngestion().deleteBook(bookId);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/** Process an uploaded book (enqueue job to generate outline and summary) */
libraryRoutes.post("/books/:bookId/process", async (c) => {
  const bookId = c.req.param("bookId");
  try {
    const book = await getLibrary().getBook(bookId);
    if (!book) {
      return c.json({ error: "Book not found" }, 404);
    }

    const job = await JobQueueService.getInstance().createJob(bookId);
    return c.json({ success: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/** Get the latest background job for a book */
libraryRoutes.get("/books/:bookId/job", async (c) => {
  const bookId = c.req.param("bookId");
  const job = JobQueueService.getInstance().getLatestJobForBook(bookId);
  return c.json({ job });
});

/** Get all background jobs */
libraryRoutes.get("/jobs", async (c) => {
  try {
    const jobs = JobQueueService.getInstance().getAllJobs();
    const bookList = await getLibrary().listBooks();
    const bookMap = new Map(bookList.map((b) => [b.id, b]));

    const jobsWithBooks = jobs.map((job) => {
      const book = bookMap.get(job.bookId);
      return {
        ...job,
        bookTitle: book?.title || job.bookId,
        bookAuthor: book?.author || "Unknown",
      };
    });

    return c.json({ jobs: jobsWithBooks });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** List all tags */
libraryRoutes.get("/tags", async (c) => {
  const tagList = getLibrary().listTags();
  return c.json({ tags: tagList });
});

/** Add a tag to a book */
libraryRoutes.post("/books/:bookId/tags", async (c) => {
  const bookId = c.req.param("bookId");
  const body = await c.req.json<{ tag: string }>();
  if (!body.tag || typeof body.tag !== "string") {
    return c.json({ error: "tag is required" }, 400);
  }
  await getLibrary().addTag(bookId, body.tag);
  return c.json({ success: true });
});

/** Remove a tag from a book */
libraryRoutes.delete("/books/:bookId/tags/:tagName", async (c) => {
  const bookId = c.req.param("bookId");
  const tagName = decodeURIComponent(c.req.param("tagName"));
  await getLibrary().removeTag(bookId, tagName);
  return c.json({ success: true });
});

