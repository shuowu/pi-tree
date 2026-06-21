/**
 * Router routes — manages ephemeral home-router sessions.
 *
 * The "router" is a system session that powers the home page chat.
 * Sessions are purely in-memory — no DB rows, no source entry.
 * Each visit creates a fresh session; the previous one is discarded.
 *
 * Mounted at `/api/router`.
 */

import { Hono } from "hono";
import { TreeManager } from "../services/tree-manager.js";
import {
  registerSession,
  closeSessionByKey,
} from "../services/session-store.js";
import { parseMentions } from "../agents/extensions/router/mention-parser.js";
import { getExtensionServices } from "../agents/context.js";
import { getAgentRegistry } from "../services/agent-registry.js";

export const routerRoutes = new Hono();

// Track the active router session key per user so we can close the old one
const activeRouterKeys = new Map<string, string>();

// One-time legacy cleanup flag
let legacyCleaned = false;

/**
 * Remove legacy home-router source and sessions from DB.
 * Safe to call multiple times — no-ops after the first successful run.
 */
async function cleanupLegacyRouterRows(): Promise<void> {
  if (legacyCleaned) return;
  try {
    const { getDb, sources, userSessions } = await import("../db/index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    db.delete(userSessions).where(eq(userSessions.sourceId, "home-router")).run();
    db.delete(sources).where(eq(sources.id, "home-router")).run();
    legacyCleaned = true;
    console.log("[router] Cleaned up legacy home-router DB rows");
  } catch {
    // DB not ready yet or already clean — will retry on next request
  }
}

// ---------------------------------------------------------------------------
// GET /router/session/:userId — creates a fresh ephemeral router session
// ---------------------------------------------------------------------------

routerRoutes.get("/session/:userId", async (c) => {
  try {
    const userId = c.req.param("userId");

    // One-time: remove legacy DB rows from before the ephemeral refactor
    await cleanupLegacyRouterRows();

    // Close any previous router session for this user
    const oldKey = activeRouterKeys.get(userId);
    if (oldKey) {
      closeSessionByKey(oldKey);
    }

    // Create an ephemeral session (no DB, no source row)
    const manager = await TreeManager.createEphemeral(userId, "router", "router");

    // Register in session-store under a synthetic key
    const sessionKey = `router:${userId}:${Date.now()}`;
    registerSession(sessionKey, manager);
    activeRouterKeys.set(userId, sessionKey);

    return c.json({ sessionKey });
  } catch (err) {
    console.error("Router session error:", err);
    return c.json({ error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /router/route — deterministic routing (no LLM needed)
//
// Resolves @mentions, checks existing sessions, and either creates/opens
// a session directly or returns { resolved: false } for LLM fallback.
// ---------------------------------------------------------------------------

routerRoutes.post("/route", async (c) => {
  try {
    const { message, userId } = await c.req.json<{ message: string; userId: string }>();
    const registry = getAgentRegistry();
    const services = getExtensionServices();
    const sourceTypeConfigs = registry.getSourceTypes();

    // 1. Parse mentions
    const parsed = parseMentions(
      message,
      sourceTypeConfigs,
      (query) => services.sources.list({ search: query }),
    );

    // YouTube URLs need LLM (source creation + transcript fetch)
    if (parsed.youtubeUrl) return c.json({ resolved: false });

    // No mentions → LLM fallback
    if (parsed.mentions.length === 0) return c.json({ resolved: false });

    // Take the first mention
    const mention = parsed.mentions[0];
    if (mention.error || !mention.sourceId) return c.json({ resolved: false });

    // 2. Look up source
    const source = services.sources.get(mention.sourceId);
    if (!source) return c.json({ resolved: false });

    const stConfig = sourceTypeConfigs.find((st) => st.key === source.type);
    let mode = mention.defaultMode ?? stConfig?.defaultMode ?? "reading";
    const strategy = stConfig?.sessionStrategy ?? "reuse-same-mode";
    const askAfterHrs = (stConfig as any)?.askAfterHours ?? 4;
    const staleAfterHrs = (stConfig as any)?.staleAfterHours ?? 12;

    // 3. Check explicit user intent from plain text
    const plainText = parsed.plainText ?? "";
    const wantsNew = /\b(new|fresh|start\s+over)\b/i.test(plainText);
    const wantsResume = /\b(continue|resume|go\s+back)\b/i.test(plainText);

    // Detect mode override from plain text (e.g. "@Dune analysis" → mode "analysis")
    if (plainText && stConfig?.sessionModes && stConfig.sessionModes.length > 1) {
      const words = plainText.toLowerCase();
      for (const m of stConfig.sessionModes) {
        if (m === mode) continue; // skip default — it's already set
        // Match mode key directly (e.g. "qa", "analysis", "reading")
        if (words.includes(m)) {
          mode = m;
          break;
        }
        // Match profile label (e.g. "q&a" → "qa", "deep analysis" → "analysis")
        try {
          const profile = registry.resolveProfile(source.type, m);
          const label = ((profile as any).label ?? "").toLowerCase();
          if (label && words.includes(label)) {
            mode = m;
            break;
          }
        } catch { /* skip */ }
      }
    }

    // 4. Get existing sessions
    const sessions = services.sessions.listForSource(userId, mention.sourceId);

    // Helper: get session mode from its context JSON
    const getSessionMode = (row: { context: string }): string => {
      try { return JSON.parse(row.context).mode ?? "reading"; } catch { return "reading"; }
    };

    // Helper: build prompt from mention metadata using plugin-declared templates
    const buildPrompt = (): string | undefined => {
      if (mention.tags?.length) {
        const tagList = mention.tags.join("', '");
        return stConfig?.tagPromptTemplate
          ? stConfig.tagPromptTemplate.replace("{tags}", tagList)
          : `Focus on tag '${tagList}'`;
      }
      if (mention.qualifier) {
        return stConfig?.qualifierPromptTemplate
          ? stConfig.qualifierPromptTemplate.replace("{qualifier}", mention.qualifier)
          : `Focus on ${mention.qualifier}`;
      }
      if (plainText) return plainText;
      return undefined;
    };

    // Helper: build a focus prefix from tags/qualifier for titles
    const focusLabel = (): string | null => {
      if (mention.tags?.length) {
        // Capitalize first letter of each tag: ["ai","sports"] → "AI, Sports"
        return mention.tags
          .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
          .join(", ");
      }
      if (mention.qualifier) return mention.qualifier;
      return null;
    };

    // Helper: build session title
    const buildTitle = (): string => {
      const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const focus = focusLabel();
      let profileLabel: string | undefined;
      try {
        const profile = registry.resolveProfile(source.type, mode);
        profileLabel = (profile as any).label;
        if ((profile as any).defaultTitle) {
          let title = (profile as any).defaultTitle
            .replace("{sourceTitle}", source.title ?? "Source")
            .replace("{date}", dateStr);
          if (focus) title = `${focus} ${title}`;
          return title;
        }
      } catch { /* no profile — use fallback */ }
      if (focus) return `${focus} ${source.title} - ${dateStr}`;
      if (strategy === "time-based") return `${source.title} - ${dateStr}`;
      // For multi-mode sources (books), append profile label to distinguish sessions
      const hasMultipleModes = (stConfig?.sessionModes?.length ?? 1) > 1;
      if (hasMultipleModes && profileLabel) {
        return `${source.title ?? "Session"} — ${profileLabel}`;
      }
      return source.title ?? "New Session";
    };

    // Helper: create session and return result
    const createAndReturn = () => {
      services.users.ensureExists(userId);
      const context: Record<string, unknown> = { mode };
      if (mention.tags?.length) context.tags = mention.tags;
      if (mention.qualifier) context.qualifier = mention.qualifier;
      const session = services.sessions.create(userId, mention.sourceId!, {
        title: buildTitle(),
        context,
      });
      const prompt = buildPrompt();
      let url = `/source/${mention.sourceId}?session=${session.id}&new=${mode}`;
      if (prompt) url += `&query=${encodeURIComponent(prompt)}`;
      return c.json({
        resolved: true,
        action: "created",
        url,
        sessionId: session.id,
        sourceId: mention.sourceId,
        sourceTitle: source.title,
        mode,
      });
    };

    // Helper: open existing session and return result
    const openAndReturn = (sessionId: number) => {
      return c.json({
        resolved: true,
        action: "opened",
        url: `/source/${mention.sourceId}?session=${sessionId}`,
        sessionId,
        sourceId: mention.sourceId,
        sourceTitle: source.title,
        mode,
      });
    };

    // 5. Apply decision logic

    // Explicit intent overrides strategy
    if (wantsNew) return createAndReturn();
    if (wantsResume && sessions.length > 0) {
      const match = sessions.find((s) => getSessionMode(s) === mode) ?? sessions[0];
      return openAndReturn(match.id);
    }

    // Tags/qualifier indicate a specific focus — always create a new session.
    // We can't match these against existing sessions (context doesn't store tags),
    // and reusing an @News#ai session for @News#sports would be wrong.
    if (mention.tags?.length || mention.qualifier) return createAndReturn();

    // No sessions → create
    if (sessions.length === 0) return createAndReturn();

    // Strategy: reuse-same-mode (books, papers)
    if (strategy === "reuse-same-mode") {
      const match = sessions.find((s) => getSessionMode(s) === mode);
      return match ? openAndReturn(match.id) : createAndReturn();
    }

    // Strategy: time-based (news)
    if (strategy === "time-based") {
      const now = Date.now();
      // Find best candidate by mode match, then most recent
      const candidates = sessions
        .filter((s) => getSessionMode(s) === mode)
        .map((s) => {
          const lastActive = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : 0;
          const hoursAgo = lastActive ? (now - lastActive) / 3600000 : Infinity;
          return { ...s, hoursAgo };
        })
        .sort((a, b) => a.hoursAgo - b.hoursAgo);

      if (candidates.length === 0) return createAndReturn();

      const best = candidates[0];
      if (best.hoursAgo < askAfterHrs) return openAndReturn(best.id);
      if (best.hoursAgo > staleAfterHrs) return createAndReturn();
      // "ask" zone — ambiguous, let LLM handle
      return c.json({ resolved: false });
    }

    // Unknown strategy — fall back to LLM
    return c.json({ resolved: false });
  } catch (err) {
    console.error("[router/route] Deterministic routing error:", err);
    return c.json({ resolved: false });
  }
});
