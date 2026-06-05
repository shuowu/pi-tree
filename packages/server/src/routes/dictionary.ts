import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { DictionaryService } from "../services/dictionary.service.js";

export const dictionaryRoutes = new Hono();

/** Stream an ephemeral dictionary lookup */
dictionaryRoutes.post("/lookup/stream", async (c) => {
  const body = await c.req.json<{
    term: string;
    bookId?: string;
    context?: string;
    userId?: string;
  }>();

  const dictService = DictionaryService.getInstance();

  return streamSSE(c, async (stream) => {
    const definition = await dictService.streamLookup(body.term, {
      bookId: body.bookId,
      context: body.context,
      onToken: async (token: string) => {
        await stream.writeSSE({ data: JSON.stringify({ type: "token", token }) });
      },
    });
    await stream.writeSSE({
      data: JSON.stringify({ type: "done", definition }),
    });
  });
});

/** Save a term to the glossary */
dictionaryRoutes.post("/glossary/save", async (c) => {
  const body = await c.req.json<{
    userId: string;
    bookId: string;
    term: string;
    definition?: string;
  }>();

  const dictService = DictionaryService.getInstance();
  await dictService.saveGlossaryEntry(body.userId, body.bookId, body.term, body.definition);
  return c.json({ ok: true });
});

/** Get all saved glossary entries for a user+book */
dictionaryRoutes.get("/glossary/:userId/:bookId", async (c) => {
  const userId = c.req.param("userId");
  const bookId = c.req.param("bookId");
  const dictService = DictionaryService.getInstance();
  const entries = dictService.getGlossaryEntries(userId, bookId);
  return c.json({ entries });
});

/** Delete a glossary entry */
dictionaryRoutes.delete("/glossary/:userId/:entryId", async (c) => {
  const userId = c.req.param("userId");
  const entryId = parseInt(c.req.param("entryId"), 10);
  const dictService = DictionaryService.getInstance();
  dictService.deleteGlossaryEntry(userId, entryId);
  return c.json({ ok: true });
});
