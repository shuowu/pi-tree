import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { DiscoverService } from "../services/discover/discover.service.js";

export const discoverRoutes = new Hono();

/** The user's most recent discover run (cached), or null. */
discoverRoutes.get("/latest", (c) => {
  const userId = c.req.query("userId") || "default";
  return c.json(DiscoverService.getInstance().getCached(userId));
});

/** Current reading-list config + available source types (for rendering controls). */
discoverRoutes.get("/config", (c) => {
  const service = DiscoverService.getInstance();
  return c.json({
    ...service.getConfig(),
    availableSourceTypes: service.availableSourceTypes(),
  });
});

/**
 * Run the discover pipeline for a user and stream progress + results.
 * Events: {type:"status"|"done"|"error", ...}
 */
discoverRoutes.post("/stream", async (c) => {
  const body = await c.req
    .json<{ userId?: string; sourceTypes?: string[] }>()
    .catch(() => ({}) as { userId?: string; sourceTypes?: string[] });
  const userId = body.userId || "default";
  const service = DiscoverService.getInstance();

  return streamSSE(c, async (stream) => {
    try {
      await service.discover(userId, {
        sourceTypes: body.sourceTypes,
        onEvent: async (event) => {
          await stream.writeSSE({ data: JSON.stringify(event) });
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[discover] /stream error:", err);
      await stream.writeSSE({ data: JSON.stringify({ type: "error", error: message }) });
    }
  });
});
