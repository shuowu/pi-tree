import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseMentions } from "./mention-parser.js";
import { RouterDestinationRegistry } from "../../../services/destination-registry.js";

export default definePiTreeExtension((pi, services) => {
  /**
   * Resolve the correct userId for tool operations.
   *
   * The AI sometimes passes the wrong user_id. This helper reads the actual
   * session owner from the DB by matching the current JSONL session file path
   * from the Pi SDK's session manager.
   */
  async function resolveUserId(aiProvidedUserId: string | undefined, ctx: ExtensionContext | undefined): Promise<string | undefined> {
    // Try to get the real userId from the current session's DB record
    if (ctx?.sessionManager) {
      try {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (sessionFile) {
          const userId = await services.sessions.resolveUserId(sessionFile);
          if (userId) return userId;
        }
      } catch {
        // Fall through to AI-provided value
      }
    }
    return aiProvidedUserId;
  }

  // ---------------------------------------------------------------------------
  // 0. Resolve Mentions — deterministic mention parsing
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "resolve_mentions",
    label: "Resolve Mentions",
    description: "Parse @mentions, :feeds, and #tags from a user message into structured routing data. ALWAYS call this first with the user's raw message before taking any action.",
    parameters: Type.Object({
      message: Type.String({ description: "The user's raw message text." }),
    }),
    async execute(_toolCallId, params) {
      const sourceTypes = services.registry.getSourceTypes();
      const result = await parseMentions(
        params.message,
        sourceTypes,
        (query) => services.sources.list({ search: query }),
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2),
        }],
        details: undefined,
      };
    },
  });

  // ---------------------------------------------------------------------------
  // 0b. Get Routing Context — plugin-declared discovery data
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "get_routing_context",
    label: "Get Routing Context",
    description: "Get plugin-provided context for a source type (e.g. available feeds/tags for news, databases for papers). Use this when you need to suggest specific options to the user.",
    parameters: Type.Object({
      source_type: Type.String({ description: "The source type key (e.g. 'news', 'paper', 'book')." }),
    }),
    async execute(_toolCallId, params) {
      try {
        const sourceTypes = services.registry.getSourceTypes();
        const stConfig = sourceTypes.find(st => st.key === params.source_type);

        if (!stConfig) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `Unknown source type: ${params.source_type}` }, null, 2) }],
            details: undefined,
          };
        }

        if (!stConfig.routingContextFile) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              sourceType: stConfig.key,
              label: stConfig.label,
              message: "This source type does not provide routing context.",
              sessionModes: stConfig.sessionModes,
              defaultMode: stConfig.defaultMode,
            }, null, 2) }],
            details: undefined,
          };
        }

        const contextPath = join(services.dataPath, stConfig.routingContextFile);
        if (!existsSync(contextPath)) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              sourceType: stConfig.key,
              message: `Config file not found: ${stConfig.routingContextFile}`,
            }, null, 2) }],
            details: undefined,
          };
        }

        const raw = JSON.parse(readFileSync(contextPath, "utf-8"));

        // Auto-compute tag summary if data is an array with tagged items
        let tagSummary: Array<{ tag: string; count: number }> | undefined;
        if (Array.isArray(raw)) {
          const tagCounts = new Map<string, number>();
          for (const item of raw) {
            if (item.tags && Array.isArray(item.tags)) {
              for (const tag of item.tags) {
                tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
              }
            }
          }
          if (tagCounts.size > 0) {
            tagSummary = Array.from(tagCounts.entries()).map(([tag, count]) => ({ tag, count }));
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify({
            sourceType: stConfig.key,
            label: stConfig.routingContextLabel,
            data: raw,
            ...(tagSummary ? { tagSummary } : {}),
          }, null, 2) }],
          details: undefined,
        };
      } catch (err: any) {
        throw new Error(`Failed to get routing context: ${err.message}`);
      }
    },
  });

  // 1. List Sources
  pi.registerTool({
    name: "list_sources",
    label: "List Sources",
    description: "List all sources in the library. Filter by type or search by title/author.",
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: "Filter by source type (e.g. 'book', 'news'). Values depend on installed plugins." })),
      search: Type.Optional(Type.String({ description: "Search sources by title or author (case-insensitive partial match)." }))
    }),
    async execute(_toolCallId, params) {
      try {
        const rows = await services.sources.list({
          type: params.type,
          search: params.search,
        });

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
        const source = await services.sources.get(params.source_id);

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

        // Look up source type config for session strategy
        const sourceTypeConfig = services.registry.getSourceTypes().find(
          st => st.key === source.type
        );
        const strategy = sourceTypeConfig?.sessionStrategy ?? "reuse-same-mode";
        const askAfterHrs = sourceTypeConfig?.askAfterHours ?? 4;
        const staleAfterHrs = sourceTypeConfig?.staleAfterHours ?? 12;
        result.sessionStrategy = strategy;

        const userId = await resolveUserId(params.user_id, ctx);
        if (userId) {
          const sessionRows = await services.sessions.listForSource(userId, params.source_id);
          const now = Date.now();

          result.sessions = sessionRows.map((row) => {
            let mode = "reading";
            try {
              const ctx = JSON.parse(row.context);
              mode = ctx.mode ?? "reading";
            } catch {
              // default
            }

            const lastActive = row.lastActiveAt ? new Date(row.lastActiveAt).getTime() : 0;
            const hoursAgo = lastActive ? Math.round((now - lastActive) / 3600000 * 10) / 10 : null;

            // Compute suggestion based on plugin-declared strategy
            let suggestion: string = "resume";
            if (strategy === "time-based" && hoursAgo !== null) {
              if (hoursAgo > staleAfterHrs) {
                suggestion = "stale";
              } else if (hoursAgo > askAfterHrs) {
                suggestion = "ask";
              }
            }

            return {
              id: row.id,
              title: row.title,
              mode,
              lastActiveAt: row.lastActiveAt,
              hoursAgo,
              suggestion,
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
      mode: Type.Optional(Type.String({ description: "Session mode — depends on source type and installed profiles. If omitted, defaults to the source type's default mode (e.g. 'news' for news sources, 'reading' for books). Only pass this if you need a non-default mode." })),
      profile: Type.Optional(Type.String({ description: "Custom profile name (e.g. 'socratic-discussion'). When set, the server uses this profile's skills/extensions instead of the default mode resolution." })),
      prompt: Type.Optional(Type.String({ description: "Optional focus for this session (e.g. 'Focus on Hacker News feed'). Passed as the first message so the AI and user both see it." }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        // Resolve userId: prefer the session owner from the DB over the AI-provided value
        const userId = await resolveUserId(params.user_id, ctx);
        if (!userId) throw new Error("Could not determine user_id — please provide it explicitly.");

        // Auto-create user if not present (mirrors TreeManager.ensureUser)
        await services.users.ensureExists(userId);

        // Resolve mode: use the source type's defaultMode instead of hardcoding "reading"
        // (e.g. news sources default to "news", books to "reading")
        const source = await services.sources.get(params.source_id);
        const sourceType = source?.type ?? "unknown";
        const sourceTypeInfo = services.registry.getSourceTypes().find(
          (st: any) => st.key === sourceType
        );
        const mode = params.mode ?? sourceTypeInfo?.defaultMode ?? "reading";

        const context: Record<string, any> = { mode };
        if (params.profile) {
          context.profile = params.profile;
        }

        // Smart title: use profile's defaultTitle template if available
        let title = params.title;
        if (!title) {
          const registry = services.registry;
          const profile = registry.resolveProfile(
            sourceType,
            mode,
          );
          if (profile.defaultTitle) {
            const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
            title = profile.defaultTitle
              .replace("{sourceTitle}", source?.title ?? "Source")
              .replace("{date}", dateStr);
          } else {
            title = source?.title ? `${source.title} Session` : "New Session";
          }
        }

        const session = await services.sessions.create(userId, params.source_id, {
          title,
          context,
        });

        return {
          content: [{ type: "text", text: JSON.stringify({
            sessionId: session.id,
            sourceId: params.source_id,
            mode,
            url: `/source/${params.source_id}?session=${session.id}&new=${mode}${params.prompt ? `&query=${encodeURIComponent(params.prompt)}` : ''}`,
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
        const session = await services.sessions.getById(params.session_id);

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

  // 4b. Navigate To — route to a feature/page destination (not a source).
  // Choices come from the RouterDestinationRegistry, so new routable pages are
  // added by registering a destination — no changes to this tool.
  const destinations = RouterDestinationRegistry.getInstance().all();
  if (destinations.length > 0) {
    const destList = destinations.map((d) => `- "${d.id}": ${d.label} — ${d.description}`).join("\n");
    pi.registerTool({
      name: "navigate_to",
      label: "Navigate To",
      description:
        "Route the user to a feature page (not a specific source/session). Use for intent that matches a destination below — in ANY language. Do NOT list library sources for these; the destination handles it. The frontend auto-redirects when this returns.\n\nAvailable destinations:\n" +
        destList,
      parameters: Type.Object({
        destination: Type.String({ description: "The destination id to navigate to (one of the ids listed above)." }),
      }),
      async execute(_toolCallId, params) {
        const dest = RouterDestinationRegistry.getInstance().get(params.destination);
        if (!dest) {
          throw new Error(
            `Unknown destination "${params.destination}". Valid: ${RouterDestinationRegistry.getInstance().all().map((d) => d.id).join(", ")}`,
          );
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ url: dest.url, destination: dest.id }, null, 2) }],
          details: undefined,
        };
      },
    });
  }

  // 5. List Profiles — for router to discover custom session modes
  pi.registerTool({
    name: "list_profiles",
    label: "List Session Profiles",
    description: "List available custom session profiles. Each profile defines a specialized AI behavior (skills, model) for sessions on a specific source type. Use this to discover available session profiles for a source type.",
    parameters: Type.Object({
      source_type: Type.Optional(Type.String({ description: "Filter by source type. Omit to see all." })),
    }),
    async execute(_toolCallId, params) {
      const profiles = services.registry.getProfiles();
      const result: Array<Record<string, unknown>> = [];
      for (const [name, profile] of profiles) {
        if (name === "router" || name === "_default") continue; // Always hide internal profiles
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

});
