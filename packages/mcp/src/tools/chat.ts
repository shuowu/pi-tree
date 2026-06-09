/**
 * Chat tools — the core reading interaction.
 *
 * send_message is the primary tool: it sends a natural-language message
 * into a reading session and returns the AI reader's response along with
 * updated session state (tree, breadcrumb, messages).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LibraryService } from "@pi-tree/server/services/library";
import { z } from "zod";
import { getSession } from "@pi-tree/server/services/session-store";

export function registerChatTools(
  server: McpServer,
  _deps: { libraryService: LibraryService },
) {
  // ------------------------------------------------------------------
  // send_message — the core reading interaction
  // ------------------------------------------------------------------
  server.tool(
    "send_message",
    `Send a message in a reading session and get the AI reader's response. This is the primary interaction tool.

The AI reader automatically:
- Classifies your intent (continue reading, go deeper, next chapter, etc.)
- Manages the conversation tree (branches on semantic shifts)
- Handles context management and compaction
- Injects relevant book content

Just send natural language — no need to manage the tree manually.

Examples:
- "Let's start reading from chapter 3"
- "What does the author mean by 'categorical imperative'?"
- "Let's move on to the next section"
- "How does this relate to what we discussed earlier?"`,
    {
      userId: z.string().describe("User ID"),
      bookId: z.string().describe("Book ID"),
      message: z
        .string()
        .describe("The message to send to the AI reader"),
      sessionId: z
        .number()
        .int()
        .optional()
        .describe("Session ID (omit for most recent)"),
    },
    async ({ userId, bookId, message, sessionId }) => {
      try {
        const manager = await getSession(userId, bookId, sessionId);
        const result = await manager.handleMessage(message, null);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  response: result.response,
                  sessionState: {
                    sessionId: result.sessionId,
                    activeNodeId: result.activeNodeId,
                    breadcrumb: result.breadcrumb,
                    tree: result.tree,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const message_ =
          err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: ${message_}` },
          ],
          isError: true,
        };
      }
    },
  );
}
