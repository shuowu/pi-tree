/**
 * Library tools — browse books, read outlines, and fetch content.
 *
 * These tools give AI agents read-only access to the book library.
 * Use get_book_outline to discover chapter/section line numbers,
 * then read_book_content to fetch specific passages.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LibraryService } from "@pi-books/server/services/library";
import { z } from "zod";

export function registerLibraryTools(
  server: McpServer,
  deps: { libraryService: LibraryService },
) {
  const { libraryService } = deps;

  // ------------------------------------------------------------------
  // list_books — browse/search the library
  // ------------------------------------------------------------------
  server.tool(
    "list_books",
    "List all books in the library. Optionally filter by search query and/or tags.",
    {
      query: z
        .string()
        .optional()
        .describe("Search by title or author"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (all must match)"),
    },
    async ({ query, tags }) => {
      const books = await libraryService.searchBooks(query, tags);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(books, null, 2),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // get_book_outline — get TOC/structure with line numbers
  // ------------------------------------------------------------------
  server.tool(
    "get_book_outline",
    "Get the table of contents / outline for a book. Returns chapter/section titles with line numbers that can be used with read_book_content.",
    {
      bookId: z
        .string()
        .describe("The book ID (folder name like 'Title_Author_Year')"),
    },
    async ({ bookId }) => {
      const outline = await libraryService.getOutline(bookId);
      if (!outline) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No outline found for this book.",
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(outline, null, 2),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // read_book_content — read raw markdown by line range
  // ------------------------------------------------------------------
  server.tool(
    "read_book_content",
    "Read the raw markdown content of a book by line range. Use get_book_outline first to discover section line numbers.",
    {
      bookId: z.string().describe("The book ID"),
      startLine: z
        .number()
        .int()
        .min(1)
        .describe("Start line (1-indexed, inclusive)"),
      endLine: z
        .number()
        .int()
        .min(1)
        .describe("End line (1-indexed, inclusive)"),
    },
    async ({ bookId, startLine, endLine }) => {
      const content = await libraryService.readContent(
        bookId,
        startLine,
        endLine,
      );
      if (content === null) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Could not read content. Check bookId and line range.",
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: content }],
      };
    },
  );
}
