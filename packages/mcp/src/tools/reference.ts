/**
 * Reference tools — dictionary lookup and glossary management.
 *
 * lookup_term uses a separate AI session (no reading session needed).
 * Glossary entries are saved per-user per-book in SQLite.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DictionaryService } from "@pi-tree/server/services/dictionary.service";
import { z } from "zod";

export function registerReferenceTools(
  server: McpServer,
  deps: { dictionaryService: DictionaryService },
) {
  const { dictionaryService } = deps;

  // ------------------------------------------------------------------
  // lookup_term — AI-powered dictionary lookup
  // ------------------------------------------------------------------
  server.tool(
    "lookup_term",
    "Look up the definition of a term or concept using AI. Optionally provide book context for more accurate definitions. This uses a separate AI session — no reading session needed.",
    {
      term: z.string().describe("The term or concept to look up"),
      sourceId: z
        .string()
        .optional()
        .describe("Source ID for context-aware definitions"),
      context: z
        .string()
        .optional()
        .describe("Surrounding text for better accuracy"),
    },
    async ({ term, sourceId, context }) => {
      try {
        let fullResponse = "";
        await dictionaryService.streamLookup(term, {
          sourceId,
          context,
          onToken: async (token) => {
            fullResponse += token;
          },
        });
        return {
          content: [{ type: "text" as const, text: fullResponse }],
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Lookup failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ------------------------------------------------------------------
  // list_glossary — get glossary entries for a user+book
  // ------------------------------------------------------------------
  server.tool(
    "list_glossary",
    "List all glossary entries saved by a user for a specific book.",
    {
      userId: z.string().describe("User ID"),
      bookId: z.string().describe("Book ID"),
    },
    async ({ userId, bookId }) => {
      const entries = await dictionaryService.getGlossaryEntries(
        userId,
        bookId,
      );
      return {
        content: [
          {
            type: "text" as const,
            text:
              entries.length > 0
                ? JSON.stringify(entries, null, 2)
                : "No glossary entries found.",
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // save_glossary_entry — save a term to the user's glossary
  // ------------------------------------------------------------------
  server.tool(
    "save_glossary_entry",
    "Save a term and its definition to the user's glossary for a book.",
    {
      userId: z.string().describe("User ID"),
      bookId: z.string().describe("Book ID"),
      term: z.string().describe("The term to save"),
      definition: z
        .string()
        .optional()
        .describe(
          "The definition (if omitted, just saves the term)",
        ),
    },
    async ({ userId, bookId, term, definition }) => {
      try {
        await dictionaryService.saveGlossaryEntry(
          userId,
          bookId,
          term,
          definition,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Saved glossary entry: "${term}"`,
            },
          ],
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: ${message}` },
          ],
          isError: true,
        };
      }
    },
  );
}
