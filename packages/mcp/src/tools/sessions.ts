/**
 * Session tools — list, create, and inspect reading sessions.
 *
 * Sessions are per-user per-book. Each session has its own conversation tree,
 * context configuration, and Pi SDK JSONL file.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LibraryService } from "@pi-tree/server/services/library";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { getDb, userBookSessions } from "@pi-tree/server/db";
import { getSession } from "@pi-tree/server/services/session-store";

/** Session mode — matches the DB context.mode values. */
type SessionMode = "reading" | "qa" | "custom";

/** Typed session context stored as JSON in the DB. */
interface SessionContext {
  mode: SessionMode;
}

/** API-facing session shape. */
interface BookSession {
  id: number;
  title: string;
  context: SessionContext;
  createdAt: string;
  lastActiveAt: string;
  isActive: boolean;
}

/** Parse a DB row into a BookSession. */
function rowToBookSession(row: {
  id: number;
  title: string;
  context: string;
  createdAt: string;
  lastActiveAt: string;
  isActive: number;
}): BookSession {
  let context: SessionContext;
  try {
    context = JSON.parse(row.context) as SessionContext;
  } catch {
    context = { mode: "reading" };
  }
  return {
    id: row.id,
    title: row.title,
    context,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    isActive: row.isActive === 1,
  };
}

export function registerSessionTools(
  server: McpServer,
  _deps: { libraryService: LibraryService },
) {
  // ------------------------------------------------------------------
  // list_sessions — list all sessions for a user+book
  // ------------------------------------------------------------------
  server.tool(
    "list_sessions",
    "List all reading sessions for a specific user and book.",
    {
      userId: z.string().describe("User ID (slug like 'shuo')"),
      bookId: z.string().describe("Book ID (folder name)"),
    },
    async ({ userId, bookId }) => {
      const db = getDb();
      const rows = db
        .select()
        .from(userBookSessions)
        .where(
          and(
            eq(userBookSessions.userId, userId),
            eq(userBookSessions.bookId, bookId),
          ),
        )
        .orderBy(desc(userBookSessions.lastActiveAt))
        .all();

      const sessions: BookSession[] = rows.map(rowToBookSession);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(sessions, null, 2),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // create_session — create a new reading session
  // ------------------------------------------------------------------
  server.tool(
    "create_session",
    "Create a new reading session for a user and book.",
    {
      userId: z.string().describe("User ID (slug like 'shuo')"),
      bookId: z.string().describe("Book ID (folder name)"),
      title: z
        .string()
        .describe("Session title (e.g. 'Chapter 3 Deep Dive')"),
      mode: z
        .enum(["reading", "qa", "custom"])
        .optional()
        .default("reading")
        .describe("Session mode"),
    },
    async ({ userId, bookId, title, mode }) => {
      const context: SessionContext = { mode };
      const now = new Date().toISOString();
      const db = getDb();

      const result = db
        .insert(userBookSessions)
        .values({
          userId,
          bookId,
          title,
          context: JSON.stringify(context),
          sessionFile: "",
          isActive: 1,
          createdAt: now,
          lastActiveAt: now,
        })
        .run();

      const newId = Number(result.lastInsertRowid);
      const row = db
        .select()
        .from(userBookSessions)
        .where(eq(userBookSessions.id, newId))
        .get();

      if (!row) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to create session.",
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(rowToBookSession(row), null, 2),
          },
        ],
      };
    },
  );

  // ------------------------------------------------------------------
  // get_session_state — get current session state
  // ------------------------------------------------------------------
  server.tool(
    "get_session_state",
    "Get the current state of a reading session, including conversation messages, tree structure, and breadcrumb navigation. If no sessionId is provided, uses the most recently active session.",
    {
      userId: z.string().describe("User ID"),
      bookId: z.string().describe("Book ID"),
      sessionId: z
        .number()
        .int()
        .optional()
        .describe("Session ID (omit for most recent)"),
    },
    async ({ userId, bookId, sessionId }) => {
      try {
        const manager = await getSession(userId, bookId, sessionId);
        const state = manager.getSessionState(null);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(state, null, 2),
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
