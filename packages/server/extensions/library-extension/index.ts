import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { eq, not, like, and, or, desc } from "drizzle-orm";
import { getDb, sources, userSessions, users } from "../../src/db/index.js";

export default function (pi: ExtensionAPI) {

  // 1. List Sources
  pi.registerTool({
    name: "list_sources",
    label: "List Sources",
    description: "List all sources in the library. Filter by type or search by title/author.",
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: "Filter by source type: 'book', 'news', 'paper', 'podcast'." })),
      search: Type.Optional(Type.String({ description: "Search sources by title or author (case-insensitive partial match)." }))
    }),
    async execute(_toolCallId, params) {
      try {
        const db = getDb();

        const conditions: ReturnType<typeof eq>[] = [
          not(eq(sources.type, "router")),
        ];

        if (params.type) {
          conditions.push(eq(sources.type, params.type));
        }

        if (params.search) {
          const pattern = `%${params.search}%`;
          conditions.push(
            or(
              like(sources.title, pattern),
              like(sources.author, pattern),
            )!,
          );
        }

        const rows = db
          .select({
            id: sources.id,
            title: sources.title,
            author: sources.author,
            type: sources.type,
            year: sources.year,
          })
          .from(sources)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(sources.title)
          .all();

        return {
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to list sources: ${err.message}`);
      }
    }
  });

  // 2. Get Source Info
  pi.registerTool({
    name: "get_source_info",
    label: "Get Source Info",
    description: "Get detailed metadata for a specific source including its type, available sessions, and status.",
    parameters: Type.Object({
      source_id: Type.String({ description: "The source ID to look up." }),
      user_id: Type.Optional(Type.String({ description: "If provided, also return existing sessions for this user." }))
    }),
    async execute(_toolCallId, params) {
      try {
        const db = getDb();

        const source = db
          .select()
          .from(sources)
          .where(eq(sources.id, params.source_id))
          .get();

        if (!source) {
          throw new Error(`Source not found: ${params.source_id}`);
        }

        const result: Record<string, any> = {
          id: source.id,
          title: source.title,
          author: source.author,
          type: source.type,
          year: source.year,
          status: source.status,
        };

        if (params.user_id) {
          const sessionRows = db
            .select({
              id: userSessions.id,
              title: userSessions.title,
              context: userSessions.context,
              lastActiveAt: userSessions.lastActiveAt,
            })
            .from(userSessions)
            .where(
              and(
                eq(userSessions.userId, params.user_id),
                eq(userSessions.sourceId, params.source_id),
                eq(userSessions.isActive, 1),
              ),
            )
            .orderBy(desc(userSessions.lastActiveAt))
            .all();

          result.sessions = sessionRows.map((row) => {
            let mode = "reading";
            try {
              const ctx = JSON.parse(row.context);
              mode = ctx.mode ?? "reading";
            } catch {
              // default
            }
            return {
              id: row.id,
              title: row.title,
              mode,
              lastActiveAt: row.lastActiveAt,
            };
          });
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to get source info: ${err.message}`);
      }
    }
  });

  // 3. Create Session
  pi.registerTool({
    name: "create_session",
    label: "Create Session",
    description: "Create a new session on a source. Returns the session ID and URL.",
    parameters: Type.Object({
      source_id: Type.String({ description: "The source to create a session on." }),
      user_id: Type.String({ description: "The user who owns the session." }),
      title: Type.String({ description: "Display title for the session." }),
      mode: Type.Optional(Type.String({ description: "Session mode: 'reading', 'qa', 'custom', 'news'. Default: 'reading'." })),
      prompt: Type.Optional(Type.String({ description: "Optional system prompt override for this session." }))
    }),
    async execute(_toolCallId, params) {
      try {
        const db = getDb();
        const now = new Date().toISOString();

        // Auto-create user if not present (mirrors TreeManager.ensureUser)
        const existingUser = db.select().from(users).where(eq(users.id, params.user_id)).get();
        if (!existingUser) {
          db.insert(users)
            .values({ id: params.user_id, displayName: params.user_id, createdAt: now, updatedAt: now })
            .run();
        }

        const context: Record<string, any> = { mode: params.mode ?? "reading" };
        if (params.prompt) {
          context.systemPrompt = params.prompt;
        }

        const result = db
          .insert(userSessions)
          .values({
            userId: params.user_id,
            sourceId: params.source_id,
            title: params.title,
            context: JSON.stringify(context),
            sessionFile: "", // Will be set on first loadOrCreate
            isActive: 1,
            createdAt: now,
            lastActiveAt: now,
          })
          .run();

        const sessionId = Number(result.lastInsertRowid);
        const mode = params.mode ?? "reading";

        return {
          content: [{ type: "text", text: JSON.stringify({
            sessionId,
            sourceId: params.source_id,
            mode,
            url: `/source/${params.source_id}?session=${sessionId}&new=${mode}`,
          }, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to create session: ${err.message}`);
      }
    }
  });

  // 4. Open Existing Session
  pi.registerTool({
    name: "open_session",
    label: "Open Session",
    description: "Get a navigation URL for an existing session. Use this to resume a session without creating a new one.",
    parameters: Type.Object({
      source_id: Type.String({ description: "The source ID." }),
      session_id: Type.Number({ description: "The session ID to open." }),
    }),
    async execute(_toolCallId, params) {
      try {
        const db = getDb();

        const session = db
          .select({
            id: userSessions.id,
            title: userSessions.title,
            context: userSessions.context,
            sourceId: userSessions.sourceId,
          })
          .from(userSessions)
          .where(eq(userSessions.id, params.session_id))
          .get();

        if (!session) {
          throw new Error(`Session not found: ${params.session_id}`);
        }

        let mode = "reading";
        try {
          const ctx = JSON.parse(session.context);
          mode = ctx.mode ?? "reading";
        } catch {
          // default
        }

        return {
          content: [{ type: "text", text: JSON.stringify({
            sessionId: session.id,
            sourceId: session.sourceId,
            mode,
            title: session.title,
            url: `/source/${session.sourceId}?session=${session.id}`,
          }, null, 2) }]
        };
      } catch (err: any) {
        throw new Error(`Failed to open session: ${err.message}`);
      }
    }
  });
}
