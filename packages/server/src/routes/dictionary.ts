import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { DictionaryService } from "../services/dictionary.service.js";

export const dictionaryRoutes = new Hono();

/** Stream an ephemeral dictionary lookup */
dictionaryRoutes.post("/lookup/stream", async (c) => {
  const body = await c.req.json<{
    term: string;
    sourceId?: string;
    context?: string;
    userId?: string;
  }>();

  const dictService = DictionaryService.getInstance();

  return streamSSE(c, async (stream) => {
    try {
      const { definition, usage } = await dictService.streamLookup(body.term, {
        sourceId: body.sourceId,
        context: body.context,
        onToken: async (token: string) => {
          await stream.writeSSE({ data: JSON.stringify({ type: "token", token }) });
        },
      });

      // Persist lookup usage if we have a userId and captured usage
      if (body.userId && usage) {
        try {
          const { getDb, messageUsage } = await import("../db/index.js");
          const db = await getDb();
          await db.insert(messageUsage).values({
            sessionId: null,
            userId: body.userId,
            category: "lookup",
            nodeId: body.term,
            model: usage.model,
            provider: usage.provider,
            inputTokens: usage.input,
            outputTokens: usage.output,
            cacheReadTokens: usage.cacheRead,
            cacheWriteTokens: usage.cacheWrite,
            totalTokens: usage.totalTokens,
            costTotal: usage.cost ? usage.cost.total : null,
            createdAt: new Date().toISOString(),
          }).run();
        } catch (err) {
          console.warn("[dictionary] Failed to persist lookup usage:", err);
        }
      }

      await stream.writeSSE({
        data: JSON.stringify({ type: "done", definition }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[stream] Error in /lookup/stream:", err);
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", error: message }),
      });
    }
  });
});

/** Get the effective dictionary prompt template */
dictionaryRoutes.get("/prompt", (c) => {
  const sourceId = c.req.query("sourceId");
  const dictService = DictionaryService.getInstance();
  const result = dictService.getLookupPrompt(sourceId || undefined);
  return c.json(result);
});

/** Save a custom dictionary prompt template */
dictionaryRoutes.put("/prompt", async (c) => {
  const body = await c.req.json<{
    scope: 'global' | 'source';
    template: string | null;
    sourceId?: string;
  }>();

  const dictService = DictionaryService.getInstance();
  try {
    dictService.saveLookupPrompt(body.scope, body.template, body.sourceId);
    // Return the new effective state
    const result = dictService.getLookupPrompt(body.sourceId);
    return c.json({ success: true, ...result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

/** Save a term to the glossary */
dictionaryRoutes.post("/glossary/save", async (c) => {
  const body = await c.req.json<{
    userId: string;
    sourceId: string;
    term: string;
    definition?: string;
  }>();

  const dictService = DictionaryService.getInstance();
  await dictService.saveGlossaryEntry(body.userId, body.sourceId, body.term, body.definition);
  return c.json({ ok: true });
});

/** Get all saved glossary entries for a user+source */
dictionaryRoutes.get("/glossary/:userId/:sourceId", async (c) => {
  const userId = c.req.param("userId");
  const sourceId = c.req.param("sourceId");
  const dictService = DictionaryService.getInstance();
  const entries = await dictService.getGlossaryEntries(userId, sourceId);
  return c.json({ entries });
});

/** Delete a glossary entry */
dictionaryRoutes.delete("/glossary/:userId/:entryId", async (c) => {
  const userId = c.req.param("userId");
  const entryId = parseInt(c.req.param("entryId"), 10);
  const dictService = DictionaryService.getInstance();
  await dictService.deleteGlossaryEntry(userId, entryId);
  return c.json({ ok: true });
});
