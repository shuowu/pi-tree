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
          `Generate a detailed outline and summary for this book.`,
          `The book has been converted to markdown at ${sourceId}/markdown/.`,
          `Please:`,
          `1. Read the book content`,
          `2. Generate and save analysis/outline.md (with navigation map, chapter breakdown, thematic map)`,
          `3. Generate and save analysis/summary.md (with key themes, chapter summaries)`,
          `4. Update analysis/toc.json with accurate, AI-cleaned headings`,
          `Save all files to the ${sourceId}/analysis/ directory.`,
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
