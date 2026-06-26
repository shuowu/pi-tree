import { Hono } from "hono";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import type { PluginRouteContext, PluginSetupResult } from "@pi-tree/plugin-sdk";
import { processBook } from "./services/process-book.js";

export function setup(ctx: PluginRouteContext): PluginSetupResult {
  const sourcesBasePath = join(ctx.dataPath, "sources");

  // Register book processor with the job queue
  ctx.jobQueue.registerProcessor("book", async (sourceId, onProgress, options) => {
    const sourceDir = join(sourcesBasePath, sourceId);

    // Force mode: delete cached analysis outputs so all phases re-run
    if (options?.force) {
      const analysisFiles = ["outline.md", "summary.md"];
      for (const file of analysisFiles) {
        const filePath = join(sourceDir, "analysis", file);
        if (existsSync(filePath)) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
        }
      }
    }

    // Phase 1: Deterministic — epub/mobi/pdf → markdown + toc.json + cover
    onProgress?.("converting", 10);
    await processBook(sourceId, {
      sourcesBasePath,
      sources: ctx.sources,
    });

    // Phase 2: Agentic — AI generates outline.md + summary.md
    // Skip if outline already exists (from a previous run)
    const outlinePath = join(sourceDir, "analysis", "outline.md");
    if (!existsSync(outlinePath)) {
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
    }

    // Note: concept extraction (Phase 3) is handled generically by the job queue
    // for all source types with `concepts: true` in their manifest.
  });

  return {
    routes: new Hono(),
    cleanup: () => {},
  };
}
