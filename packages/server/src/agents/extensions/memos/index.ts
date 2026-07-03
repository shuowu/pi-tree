import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { definePiTreeExtension, jsonResult, toolError } from "@pi-tree/plugin-sdk";
import { MemoService } from "../../../services/memo-service.js";

export default definePiTreeExtension((pi, services) => {
  const memoService = MemoService.getInstance();

  /**
   * Resolve the correct userId from the Pi SDK session context.
   * Falls back to a user-provided value when the session file is unavailable.
   */
  async function resolveUserId(
    aiProvidedUserId: string | undefined,
    ctx: ExtensionContext | undefined,
  ): Promise<string | undefined> {
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

  /**
   * Extract the sourceId from the session file path.
   * Session files live at: <DATA_PATH>/sessions/<sourceId>/<userId>/*.jsonl
   */
  function extractSourceId(sessionFile: string): string | undefined {
    const pathParts = sessionFile.split("/");
    const sessionsIdx = pathParts.indexOf("sessions");
    if (sessionsIdx >= 0 && sessionsIdx + 1 < pathParts.length) {
      return pathParts[sessionsIdx + 1];
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // save_memo — save a key insight, decision, or takeaway
  // ---------------------------------------------------------------------------

  pi.registerTool({
    name: "save_memo",
    label: "Save Memo",
    description: `Save a key insight, decision, or takeaway as a memo. Use this when:
- The user asks you to save/remember something
- You've produced a substantial analysis the user might want to keep
- The user says "save this", "remember this", "note this down"
- At the end of a long productive session, offer to save key takeaways

The memo is saved to the user's personal memo collection and can be recalled later via /recall.`,
    parameters: Type.Object({
      title: Type.String({ description: "Short descriptive title for the memo" }),
      content: Type.String({ description: "The memo content in markdown format" }),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Optional tags for categorization (e.g. 'investment', 'key-insight')",
        }),
      ),
      user_id: Type.Optional(
        Type.String({ description: "Current user ID. Auto-detected if omitted." }),
      ),
      source_id: Type.Optional(
        Type.String({ description: "Current source ID. Auto-detected if omitted." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const userId = await resolveUserId(params.user_id, ctx);
        if (!userId) {
          throw new Error(
            "Cannot determine user context for memo save. Please provide user_id.",
          );
        }

        // Resolve sourceId & sessionId: prefer explicit param, then extract from session file
        let sourceId = params.source_id;
        let sessionId: number | undefined;
        
        if (ctx?.sessionManager) {
          const sessionFile = ctx.sessionManager.getSessionFile();
          if (sessionFile) {
            if (!sourceId) {
              sourceId = extractSourceId(sessionFile);
            }
            sessionId = await services.sessions.resolveSessionId(sessionFile);
          }
        }

        const memo = await memoService.create(userId, {
          title: params.title,
          content: params.content,
          sourceId: sourceId ?? undefined,
          sessionId: sessionId ?? undefined,
          origin: "ai_suggested",
          tags: params.tags,
        });

        return jsonResult({
          saved: true,
          memoId: memo.id,
          title: memo.title,
          message: `Memo saved: "${memo.title}". The user can find it in the Memos panel or at /memos.`,
        });
      } catch (err) {
        throw toolError("save memo", err);
      }
    },
  });
});
