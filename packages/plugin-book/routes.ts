import { Hono } from "hono";
import { join } from "node:path";
import type { PluginRouteContext, PluginSetupResult } from "@pi-tree/plugin-sdk";
import { processBook } from "./services/process-book.js";

export function setup(ctx: PluginRouteContext): PluginSetupResult {
  // Register book processor with the job queue
  ctx.jobQueue.registerProcessor("book", async (sourceId, onProgress) => {
    // Phase 1: Deterministic — epub/mobi/pdf → markdown + toc.json + cover
    onProgress?.("converting", 10);
    const result = await processBook(sourceId, {
      sourcesBasePath: join(ctx.dataPath, "sources"),
      sources: ctx.sources,
    });

    // Skip analysis if book was already processed (idempotent re-run)
    if (result.alreadyProcessed) return;

    // Phase 2: Agentic — AI generates outline.md + summary.md
    onProgress?.("analyzing", 50);
    try {
      await ctx.agentTask.run({
        sourceId,
        mode: "analysis",
        message: [
          `Generate a reading outline and brief summary for this book.`,
          ``,
          `A table of contents with chapter headings and line numbers is already at ${sourceId}/analysis/toc.json — use it as your starting point.`,
          `Read the first few paragraphs of each chapter (using toc.json line numbers as offsets) to understand what each covers.`,
          ``,
          `Then write exactly two files:`,
          `1. ${sourceId}/analysis/outline.md — concise chapter list with one-line descriptions and line numbers for navigation`,
          `2. ${sourceId}/analysis/summary.md — brief book overview (what it's about, who it's for, key takeaways)`,
          ``,
          `Keep both files concise. This is a navigation aid, not a deep analysis.`,
        ].join("\n"),
      });
    } catch (err) {
      // Analysis failure is non-fatal — the book is still readable
      console.error(`[book] Analysis failed for ${sourceId}, book is still usable:`, err);
    }
  });

  return {
    routes: new Hono(),
    cleanup: () => {},
  };
}
