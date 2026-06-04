import { Hono } from "hono";
import { LibraryService } from "../services/library.js";

export const libraryRoutes = new Hono();

const library = new LibraryService();

/** List all books in the library */
libraryRoutes.get("/books", async (c) => {
  const books = await library.listBooks();
  return c.json({ books });
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
