import { Hono } from "hono";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import type { PluginRouteContext, PluginSetupResult } from "@pi-tree/plugin-sdk";
import { processBook } from "./services/process-book.js";
import { epubPath, getEpubInfo, readEpubFile } from "./services/epub-reader.js";

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

  // In-app EPUB reader: serve structure + files straight from original.epub
  const routes = new Hono();

  routes.get("/:sourceId/epub", async (c) => {
    const file = epubPath(sourcesBasePath, c.req.param("sourceId"));
    if (!file || !existsSync(file)) return c.json({ error: "No EPUB for this source" }, 404);
    try {
      return c.json(await getEpubInfo(file));
    } catch (err) {
      console.error(`[book] Failed to open EPUB for reader:`, err);
      return c.json({ error: "Could not open EPUB" }, 500);
    }
  });

  routes.get("/:sourceId/epub/file", async (c) => {
    const file = epubPath(sourcesBasePath, c.req.param("sourceId"));
    const path = c.req.query("path");
    if (!path || !file || !existsSync(file)) return c.json({ error: "Not found" }, 404);
    try {
      const result = await readEpubFile(file, path);
      if (!result) return c.json({ error: "Not found" }, 404);
      return new Response(new Uint8Array(result.data), {
        headers: {
          "Content-Type": result.mimeType,
          "Cache-Control": "private, max-age=3600",
          // Book content is rendered by the app, never executed as a page
          "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        },
      });
    } catch (err) {
      console.error(`[book] Failed to read EPUB file ${path}:`, err);
      return c.json({ error: "Could not read file" }, 500);
    }
  });

  return {
    routes,
    cleanup: () => {},
  };
}
