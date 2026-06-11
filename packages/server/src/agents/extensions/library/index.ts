import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { eq, not, like, and, or, desc } from "drizzle-orm";
import { getExtensionServices } from "../../context.js";
import { getAgentRegistry } from "../../../services/agent-registry.js";


/**
 * Resolve the correct userId for tool operations.
 *
 * The AI sometimes passes the wrong user_id. This helper reads the actual
 * session owner from the DB by matching the current JSONL session file path
 * from the Pi SDK's session manager.
 */
function resolveUserId(aiProvidedUserId: string | undefined, ctx: ExtensionContext | undefined): string | undefined {
  const { db: getDb, schema: { userSessions } } = getExtensionServices();
  // Try to get the real userId from the current session's DB record
  if (ctx?.sessionManager) {
    try {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile) {
        const db = getDb();
        const row = db.select({ userId: userSessions.userId })
          .from(userSessions)
          .where(eq(userSessions.sessionFile, sessionFile))
          .get();
        if (row) return row.userId;
      }
    } catch {
      // Fall through to AI-provided value
    }
  }
  return aiProvidedUserId;
}

export default function (pi: ExtensionAPI) {
  const { db: getDb, schema: { sources, userSessions, users } } = getExtensionServices();

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
          content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
          details: undefined,
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

        const userId = resolveUserId(params.user_id, ctx);
        if (userId) {
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
                eq(userSessions.userId, userId),
                eq(userSessions.sourceId, params.source_id),
                eq(userSessions.isActive, 1),
              ),
            )
            .orderBy(desc(userSessions.lastActiveAt))
            .all();

          result.sessions = sessionRows.map((row: any) => {
            let mode = "reading";
            let prompt: string | undefined = undefined;
            try {
              const ctx = JSON.parse(row.context);
              mode = ctx.mode ?? "reading";
              prompt = ctx.systemPrompt;
            } catch {
              // default
            }
            return {
              id: row.id,
              title: row.title,
              mode,
              prompt,
              lastActiveAt: row.lastActiveAt,
            };
          });
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: undefined,
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
    description: "Create a new session on a source. Returns the session ID and URL. The user_id is auto-detected from the current session — you don't need to pass it.",
    parameters: Type.Object({
      source_id: Type.String({ description: "The source to create a session on." }),
      user_id: Type.Optional(Type.String({ description: "The user who owns the session. Auto-detected if omitted." })),
      title: Type.String({ description: "Display title for the session." }),
      mode: Type.Optional(Type.String({ description: "Session mode: 'reading', 'qa', 'custom', 'news', or a custom profile name. Default: 'reading'." })),
      profile: Type.Optional(Type.String({ description: "Custom profile name (e.g. 'socratic-discussion'). When set, the server uses this profile's skills/extensions instead of the default mode resolution." })),
      prompt: Type.Optional(Type.String({ description: "Optional system prompt override for this session." }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const db = getDb();
        const now = new Date().toISOString();

        // Resolve userId: prefer the session owner from the DB over the AI-provided value
        const userId = resolveUserId(params.user_id, ctx);
        if (!userId) throw new Error("Could not determine user_id — please provide it explicitly.");

        // Auto-create user if not present (mirrors TreeManager.ensureUser)
        const existingUser = db.select().from(users).where(eq(users.id, userId)).get();
        if (!existingUser) {
          db.insert(users)
            .values({ id: userId, displayName: userId, createdAt: now, updatedAt: now })
            .run();
        }

        const context: Record<string, any> = { mode: params.mode ?? "reading" };
        if (params.profile) {
          context.profile = params.profile;
        }
        if (params.prompt) {
          context.systemPrompt = params.prompt;
        }

        // Smart title: enhance generic titles with source name + date
        let title = params.title;
        const mode = params.mode ?? "reading";
        if (mode === "news") {
          const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
          if (!title || /news.*scanner|news.*trends|briefing/i.test(title)) {
            // Generic title — build from source name
            const src = db.select({ title: sources.title }).from(sources).where(eq(sources.id, params.source_id)).get();
            const srcLabel = src?.title?.replace(/feed$/i, "").trim() ?? "News";
            title = `${srcLabel} - ${dateStr}`;
          } else if (!/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(title)) {
            // Has a custom title but no date — append date
            title = `${title} - ${dateStr}`;
          }
        } else if (!title) {
          const src = db.select({ title: sources.title }).from(sources).where(eq(sources.id, params.source_id)).get();
          title = src?.title ? `Reading ${src.title}` : "New Session";
        }

        const result = db
          .insert(userSessions)
          .values({
            userId,
            sourceId: params.source_id,
            title,
            context: JSON.stringify(context),
            sessionFile: `pending-${Date.now()}`, // Placeholder — overwritten on first loadOrCreate
            isActive: 1,
            createdAt: now,
            lastActiveAt: now,
          })
          .run();

        const sessionId = Number(result.lastInsertRowid);

        return {
          content: [{ type: "text", text: JSON.stringify({
            sessionId,
            sourceId: params.source_id,
            mode,
            url: `/source/${params.source_id}?session=${sessionId}&new=${mode}`,
          }, null, 2) }],
          details: undefined,
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
          }, null, 2) }],
          details: undefined,
        };
      } catch (err: any) {
        throw new Error(`Failed to open session: ${err.message}`);
      }
    }
  });

  // 5. List Profiles — for router to discover custom session modes
  pi.registerTool({
    name: "list_profiles",
    label: "List Session Profiles",
    description: "List available custom session profiles. Each profile defines a specialized AI behavior (skills, model) for sessions on a specific source type. Use this when the user's intent doesn't match standard modes (reading/qa/news).",
    parameters: Type.Object({
      source_type: Type.Optional(Type.String({ description: "Filter by source type (e.g. 'book', 'news'). Omit to see all." })),
    }),
    async execute(_toolCallId, params) {
      const registry = getAgentRegistry();
      const profiles = registry.getProfiles();
      // Filter out built-in profiles and optionally by source type
      const builtinKeys = new Set([
        "book.reading", "book.qa", "book.analysis", "book",
        "news.news", "news", "router", "_default",
      ]);
      const result: Array<Record<string, unknown>> = [];
      for (const [name, profile] of profiles) {
        if (builtinKeys.has(name)) continue;
        if (params.source_type && profile.sourceType && profile.sourceType !== params.source_type) continue;
        result.push({
          name,
          label: profile.label,
          ...(profile.description ? { description: profile.description } : {}),
          ...(profile.sourceType ? { source_type: profile.sourceType } : {}),
        });
      }
      if (result.length === 0) {
        return {
          content: [{ type: "text", text: "No custom profiles available." }],
          details: undefined,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: undefined,
      };
    }
  });

}
