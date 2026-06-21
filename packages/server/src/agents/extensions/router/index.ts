import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { definePiTreeExtension } from "@pi-tree/plugin-sdk";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { parseMentions } from "./mention-parser.js";

export default definePiTreeExtension((pi, services) => {
  /**
   * Resolve the correct userId for tool operations.
   *
   * The AI sometimes passes the wrong user_id. This helper reads the actual
   * session owner from the DB by matching the current JSONL session file path
   * from the Pi SDK's session manager.
   */
  function resolveUserId(aiProvidedUserId: string | undefined, ctx: ExtensionContext | undefined): string | undefined {
    // Try to get the real userId from the current session's DB record
    if (ctx?.sessionManager) {
      try {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (sessionFile) {
          const userId = services.sessions.resolveUserId(sessionFile);
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
      const result = parseMentions(
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
        const rows = services.sources.list({
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
        const source = services.sources.get(params.source_id);

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

        const userId = resolveUserId(params.user_id, ctx);
        if (userId) {
          const sessionRows = services.sessions.listForSource(userId, params.source_id);
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
        const userId = resolveUserId(params.user_id, ctx);
        if (!userId) throw new Error("Could not determine user_id — please provide it explicitly.");

        // Auto-create user if not present (mirrors TreeManager.ensureUser)
        services.users.ensureExists(userId);

        // Resolve mode: use the source type's defaultMode instead of hardcoding "reading"
        // (e.g. news sources default to "news", books to "reading")
        const source = services.sources.get(params.source_id);
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
          const registry = services.registry as any;
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

        const session = services.sessions.create(userId, params.source_id, {
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
        const session = services.sessions.getById(params.session_id);

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

  // 6. Create YouTube Source — auto-create a source from a YouTube URL
  pi.registerTool({
    name: "create_youtube_source",
    label: "Create YouTube Source",
    description:
      "Create a new YouTube video source from a URL. Fetches video metadata (title, channel, duration) and adds it to the library. If a source for this video already exists, returns the existing one. Use this when a user pastes a YouTube link in chat.",
    parameters: Type.Object({
      url: Type.String({
        description:
          'YouTube video URL (e.g. "https://www.youtube.com/watch?v=dQw4w9WgXcQ") or video ID.',
      }),
    }),
    async execute(_toolCallId, params) {
      try {
        // Extract video ID from URL
        const VIDEO_ID_RE = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
        const BARE_ID_RE = /^([a-zA-Z0-9_-]{11})$/;

        let videoId: string | null = null;
        const m1 = params.url.match(VIDEO_ID_RE);
        if (m1) videoId = m1[1];
        if (!videoId) {
          const m2 = params.url.match(BARE_ID_RE);
          if (m2) videoId = m2[1];
        }

        if (!videoId) {
          throw new Error(
            `Invalid YouTube URL: ${params.url}. Please provide a valid youtube.com or youtu.be link.`,
          );
        }

        // Check if a source for this video already exists
        const existingSources = services.sources.list({ type: "youtube" });
        let existing: any = null;
        for (const s of existingSources) {
          const full = services.sources.get(s.id);
          if (full?.metadata?.videoId === videoId) {
            existing = full;
            break;
          }
        }

        if (existing) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    sourceId: existing.id,
                    title: existing.title,
                    author: existing.author,
                    alreadyExists: true,
                  },
                  null,
                  2,
                ),
              },
            ],
            details: undefined,
          };
        }

        // Fetch video info from YouTube
        const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        if (!pageRes.ok) throw new Error(`Failed to fetch YouTube page: HTTP ${pageRes.status}`);
        const html = await pageRes.text();

        // Extract ytInitialPlayerResponse
        const prMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s)
          ?? html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s);
        if (!prMatch) throw new Error("Could not extract video info from YouTube page.");

        let playerResponse: any;
        try { playerResponse = JSON.parse(prMatch[1]); } catch { throw new Error("Failed to parse YouTube player response."); }
        const details = playerResponse.videoDetails;
        if (!details) throw new Error("No video details found.");

        const title = details.title ?? "Untitled";
        const author = details.author ?? "Unknown";
        const lengthSeconds = parseInt(details.lengthSeconds ?? "0", 10);
        const publishDate = playerResponse.microformat?.playerMicroformatRenderer?.publishDate ?? "";
        const viewCount = parseInt(details.viewCount ?? "0", 10);
        const thumbnailUrl = details.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ?? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

        // Generate a slug ID from the video title
        const baseId =
          title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60) || "youtube-video";

        let sourceIdCandidate = baseId;
        if (services.sources.get(sourceIdCandidate)) {
          sourceIdCandidate = `${baseId}-${videoId.slice(0, 6)}`;
        }

        // Create source
        const created = services.sources.create({
          id: sourceIdCandidate,
          title,
          author,
          type: "youtube",
          source: "user",
          status: "ready",
          metadata: {
            videoId,
            youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
            thumbnailUrl,
            embedUrl: `https://www.youtube.com/embed/${videoId}`,
            lengthSeconds,
            publishDate,
            viewCount,
            description: (details.shortDescription ?? "").slice(0, 1000),
          },
        });

        // Eagerly pre-fetch and cache the transcript at creation time in the background/sync
        try {
          const _require = createRequire(import.meta.url);
          const ytServicePath = join(dirname(_require.resolve("pi-tree-youtube/package.json")), "services", "youtube.js");
          const { getTranscript } = await import(ytServicePath);
          const segments = await getTranscript(videoId);
          const data = { videoId, fetchedAt: new Date().toISOString(), segments };

          const sourcePath = join(services.dataPath, "sources", created.id, "transcript.json");
          const fallbackPath = join(services.dataPath, "plugins", "youtube", `${videoId}.json`);

          const dir = join(services.dataPath, "sources", created.id);
          const fallbackDir = join(services.dataPath, "plugins", "youtube");
          const { mkdirSync, writeFileSync } = await import("node:fs");
          mkdirSync(dir, { recursive: true });
          mkdirSync(fallbackDir, { recursive: true });

          const raw = JSON.stringify(data, null, 2);
          writeFileSync(sourcePath, raw, "utf-8");
          writeFileSync(fallbackPath, raw, "utf-8");
          console.log(`[router/create_youtube_source] Successfully pre-fetched and cached transcript for ${created.id}.`);

          // Fetch and cache the cover thumbnail as cover.jpg
          if (thumbnailUrl) {
            try {
              const res = await fetch(thumbnailUrl);
              if (res.ok) {
                const buffer = await res.arrayBuffer();
                const coverPath = join(dir, "cover.jpg");
                writeFileSync(coverPath, Buffer.from(buffer));
                console.log(`[router/create_youtube_source] Successfully cached cover image for ${created.id}.`);
              } else {
                console.warn(`[router/create_youtube_source] Failed to fetch cover from ${thumbnailUrl}: ${res.statusText}`);
              }
            } catch (coverErr: any) {
              console.warn(`[router/create_youtube_source] Error caching cover image for ${created.id}:`, coverErr.message);
            }
          }
        } catch (err: any) {
          console.warn(`[router/create_youtube_source] Failed to pre-fetch transcript for ${created.id}:`, err.message);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  sourceId: created.id,
                  title,
                  author,
                  duration: `${Math.floor(lengthSeconds / 60)}m ${lengthSeconds % 60}s`,
                  alreadyExists: false,
                },
                null,
                2,
              ),
            },
          ],
          details: undefined,
        };
      } catch (err: any) {
        throw new Error(`Failed to create YouTube source: ${err.message}`);
      }
    },
  });

});
