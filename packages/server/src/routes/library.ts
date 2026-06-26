import { Hono } from "hono";
import { LibraryService } from "../services/library.js";
import { readFile, readdir, stat, mkdir, copyFile, writeFile } from "node:fs/promises";
import { extname, resolve, isAbsolute, join } from "node:path";
import { getDb, sources as sourcesTable } from "../db/index.js";
import { eq } from "drizzle-orm";
import { getJobQueue } from "../services/job-queue.js";

export const libraryRoutes = new Hono();

let _library: LibraryService | null = null;

function getLibrary(): LibraryService {
  if (!_library) {
    _library = new LibraryService();
  }
  return _library;
}

/** @internal — used by tests to reset singletons */
export function _resetLibraryServices(): void {
  _library = null;
}

const dataPath =
  process.env.DATA_PATH ??
  join(process.env.HOME ?? "~", ".local", "share", "pi-tree");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** List all sources in the library (with optional search/tag/type filter) */
libraryRoutes.get("/sources", async (c) => {
  const search = c.req.query("search");
  const tagsParam = c.req.query("tags");
  const filterTags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
  const typeFilter = c.req.query("type");

  let filteredSources =
    search || (filterTags && filterTags.length > 0)
      ? await getLibrary().searchSources(search, filterTags)
      : await getLibrary().listSources();

  if (typeFilter) {
    filteredSources = filteredSources.filter((s) => s.type === typeFilter);
  }

  return c.json({ sources: filteredSources });
});

/** Get a source's cover image */
libraryRoutes.get("/sources/:sourceId/cover", async (c) => {
  const sourceId = c.req.param("sourceId");
  const coverPath = await getLibrary().getCoverPath(sourceId);
  if (!coverPath) return c.json({ error: "Cover not found" }, 404);

  try {
    const fileData = await readFile(coverPath);
    const ext = extname(coverPath).toLowerCase();
    let contentType = "image/jpeg";
    if (ext === ".png") contentType = "image/png";
    else if (ext === ".webp") contentType = "image/webp";
    else if (ext === ".gif") contentType = "image/gif";

    return c.body(fileData, 200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    });
  } catch (err) {
    return c.json({ error: "Failed to read cover image" }, 500);
  }
});

/** Get a single source's details + outline */
libraryRoutes.get("/sources/:sourceId", async (c) => {
  const sourceId = c.req.param("sourceId");
  const source = await getLibrary().getSource(sourceId);
  if (!source) return c.json({ error: "Source not found" }, 404);
  return c.json(source);
});

/** Get a source's outline (TOC) */
libraryRoutes.get("/sources/:sourceId/outline", async (c) => {
  const sourceId = c.req.param("sourceId");
  const outline = await getLibrary().getOutline(sourceId);
  if (!outline) return c.json({ error: "Outline not found" }, 404);
  return c.json(outline);
});

/** Read a section of the source's markdown */
libraryRoutes.get("/sources/:sourceId/content", async (c) => {
  const sourceId = c.req.param("sourceId");
  const startLine = Number(c.req.query("start") ?? 1);
  const endLine = Number(c.req.query("end") ?? startLine + 50);
  const content = await getLibrary().readContent(sourceId, startLine, endLine);
  if (!content) return c.json({ error: "Content not found" }, 404);
  return c.json({ content, startLine, endLine });
});

/** Get headings from the source's markdown (lightweight TOC with line numbers) */
libraryRoutes.get("/sources/:sourceId/headings", async (c) => {
  const sourceId = c.req.param("sourceId");
  const headings = await getLibrary().getHeadings(sourceId);
  if (!headings) return c.json({ error: "Source not found" }, 404);
  return c.json({ headings });
});

/** List analysis files for a source */
libraryRoutes.get("/sources/:sourceId/analysis", async (c) => {
  const sourceId = c.req.param("sourceId");
  const analysisDir = join(getLibrary().getSourcesPath(), sourceId, "analysis");

  try {
    const entries = await readdir(analysisDir);
    const fileInfos = await Promise.all(
      entries
        .filter((f) => !f.startsWith("."))
        .map(async (f) => {
          try {
            const s = await stat(join(analysisDir, f));
            if (!s.isFile()) return null;
            return { name: f, size: s.size, modified: s.mtime.toISOString() };
          } catch {
            return null;
          }
        }),
    );
    return c.json({ files: fileInfos.filter(Boolean) });
  } catch {
    return c.json({ files: [] });
  }
});

/** Serve a specific analysis file */
libraryRoutes.get("/sources/:sourceId/analysis/:filename", async (c) => {
  const { sourceId, filename } = c.req.param();

  // Security: prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const filePath = join(getLibrary().getSourcesPath(), sourceId, "analysis", filename);
  try {
    const content = await readFile(filePath, "utf-8");
    const ext = extname(filename).toLowerCase();
    const contentType =
      ext === ".json" ? "application/json" :
      ext === ".md" ? "text/markdown" :
      "text/plain";
    return c.text(content, 200, { "Content-Type": contentType });
  } catch {
    return c.json({ error: "File not found" }, 404);
  }
});

/** Serve concepts data for a source */
libraryRoutes.get("/sources/:sourceId/concepts", async (c) => {
  const sourceId = c.req.param("sourceId");
  const conceptsPath = join(getLibrary().getSourcesPath(), sourceId, "analysis", "concepts.json");

  try {
    const raw = await readFile(conceptsPath, "utf-8");
    const parsed = JSON.parse(raw);
    const concepts = Array.isArray(parsed) ? parsed : parsed.concepts ?? [];
    const relations = parsed.relations ?? [];

    // Build cross-source references
    const allSources = getDb().select().from(sourcesTable).all();
    const crossRefs: Record<string, { sourceId: string; title: string }[]> = {};

    for (const source of allSources) {
      if (source.id === sourceId) continue;
      const otherPath = join(getLibrary().getSourcesPath(), source.id, "analysis", "concepts.json");
      try {
        const otherRaw = await readFile(otherPath, "utf-8");
        const otherParsed = JSON.parse(otherRaw);
        const otherConcepts = Array.isArray(otherParsed) ? otherParsed : otherParsed.concepts ?? [];
        const otherTerms = new Set(otherConcepts.map((c: any) => c.term?.toLowerCase()));

        for (const concept of concepts) {
          if (concept.term && otherTerms.has(concept.term.toLowerCase())) {
            if (!crossRefs[concept.term]) crossRefs[concept.term] = [];
            crossRefs[concept.term].push({ sourceId: source.id, title: source.title });
          }
        }
      } catch {
        // No concepts for this source
      }
    }

    return c.json({ concepts, relations, crossRefs });
  } catch {
    return c.json({ concepts: [], relations: [], crossRefs: {} });
  }
});

/** Create a metadata-only source (no file upload — for papers, podcasts, etc.) */
libraryRoutes.post("/sources/create", async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      author?: string;
      year?: number;
      type: string;
      metadata?: Record<string, unknown>;
      contentPath?: string;
    }>();

    if (!body.title || typeof body.title !== "string") {
      return c.json({ error: "title is required" }, 400);
    }
    if (!body.type || typeof body.type !== "string") {
      return c.json({ error: "type is required" }, 400);
    }

    // Generate a slug ID from the title
    const baseId = body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const db = getDb();
    const now = new Date().toISOString();

    // Handle duplicate IDs by appending a suffix
    let id = baseId || "untitled";
    let suffix = 0;
    while (true) {
      const existing = db
        .select({ id: sourcesTable.id })
        .from(sourcesTable)
        .where(eq(sourcesTable.id, id))
        .get();
      if (!existing) break;
      suffix++;
      id = `${baseId}-${suffix}`;
    }

    const values = {
      id,
      type: body.type,
      title: body.title.trim(),
      author: body.author?.trim() ?? "",
      year: body.year ?? null,
      source: "user" as const,
      status: "ready" as const,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(sourcesTable).values(values).run();

    // Fetch and save cover if thumbnailUrl is present in metadata
    if (body.metadata && typeof body.metadata === "object") {
      const thumbUrl = body.metadata.thumbnailUrl;
      if (typeof thumbUrl === "string" && thumbUrl.startsWith("http")) {
        try {
          const res = await fetch(thumbUrl);
          if (res.ok) {
            const buffer = await res.arrayBuffer();
            const targetDir = join(dataPath, "sources", id);
            await mkdir(targetDir, { recursive: true });
            const coverPath = join(targetDir, "cover.jpg");
            await writeFile(coverPath, Buffer.from(buffer));
            console.log(`[sources/create] Successfully cached cover image for ${id}`);
          } else {
            console.warn(`[sources/create] Failed to fetch cover from ${thumbUrl}: ${res.statusText}`);
          }
        } catch (err: any) {
          console.warn(`[sources/create] Error caching cover image for ${id}:`, err.message);
        }
      }
    }

    // If contentPath provided, copy content to sources/{id}/markdown/
    let hasMarkdown = false;
    if (body.contentPath) {
      // Resolve: absolute stays absolute, relative resolves from DATA_PATH
      const resolvedPath = isAbsolute(body.contentPath)
        ? resolve(body.contentPath)
        : resolve(dataPath, body.contentPath);

      // Validate file exists
      try {
        const st = await stat(resolvedPath);
        if (!st.isFile()) {
          // Still create the source, just skip the copy
          console.warn(`[sources/create] contentPath is not a file: ${resolvedPath}`);
        } else {
          const targetDir = join(dataPath, "sources", id, "markdown");
          await mkdir(targetDir, { recursive: true });
          const targetFile = join(targetDir, "content.md");
          await copyFile(resolvedPath, targetFile);
          hasMarkdown = true;
        }
      } catch (err) {
        console.warn(`[sources/create] contentPath not found: ${resolvedPath}`);
      }
    }

    return c.json(
      {
        id: values.id,
        type: values.type,
        title: values.title,
        author: values.author,
        year: values.year,
        source: values.source,
        status: values.status,
        metadata: body.metadata ?? null,
        hasMarkdown,
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/**
 * Upload a file for a new source.
 *
 * Generic: stores the uploaded file at $DATA_PATH/sources/{sourceId}/original{ext},
 * creates a DB row, and returns the source info. Does NOT trigger processing —
 * the book plugin's `process_book` tool handles that when the AI session starts.
 *
 * For .md files: saves directly as markdown content and marks the source as 'ready'.
 * For all other files: saves the original and marks the source as 'uploaded'.
 */
libraryRoutes.post("/sources", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!file || typeof file === "string") {
      return c.json({ error: "No file provided" }, 400);
    }

    const title = body["title"];
    const author = body["author"];
    if (!title || typeof title !== "string") {
      return c.json({ error: "title is required" }, 400);
    }
    if (!author || typeof author !== "string") {
      return c.json({ error: "author is required" }, 400);
    }

    const yearStr = body["year"];
    const year =
      typeof yearStr === "string" && yearStr.length > 0
        ? parseInt(yearStr, 10)
        : undefined;

    const typeStr = body["type"];
    // File uploads default to 'book' — the client should always send the type
    const sourceType = typeof typeStr === "string" && typeStr.length > 0 ? typeStr : "book";

    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const filename = (file as File).name ?? "upload";
    const ext = extname(filename).toLowerCase();

    // Generate source ID
    const parts = [title as string, author as string];
    if (year && !isNaN(year)) parts.push(String(year));
    let baseId = slugify(parts.join("-"));
    let sourceId = baseId;
    let suffix = 1;

    const db = getDb();
    while (true) {
      const existing = db.select().from(sourcesTable).where(eq(sourcesTable.id, sourceId)).get();
      if (!existing) break;
      suffix++;
      sourceId = `${baseId}-${suffix}`;
    }

    // Create source directory (markdown/ will be created by process_book)
    const sourceDir = join(dataPath, "sources", sourceId);
    await mkdir(sourceDir, { recursive: true });

    // Save original file
    const originalPath = join(sourceDir, `original${ext}`);
    await writeFile(originalPath, buffer);

    const now = new Date().toISOString();

    // For markdown files, skip conversion — save directly and mark ready
    if (ext === ".md") {
      const markdownDir = join(sourceDir, "markdown");
      await mkdir(markdownDir, { recursive: true });
      await writeFile(join(markdownDir, "content.md"), buffer);

      db.insert(sourcesTable)
        .values({
          id: sourceId,
          type: sourceType,
          title: title as string,
          author: author as string,
          year: year && !isNaN(year) ? year : null,
          source: "upload",
          status: "ready",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return c.json(
        {
          id: sourceId,
          type: sourceType,
          title,
          author,
          year: year && !isNaN(year) ? year : 0,
          folderName: sourceId,
          progress: 100,
          hasMarkdown: true,
          hasOutline: false,
          hasCover: false,
          source: "upload",
          status: "ready",
        },
        201,
      );
    }

    // For all other file types, save and mark as 'pending' (awaiting processing)
    db.insert(sourcesTable)
      .values({
        id: sourceId,
        type: sourceType,
        title: title as string,
        author: author as string,
        year: year && !isNaN(year) ? year : null,
        source: "upload",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Auto-enqueue processing (or concept extraction) for eligible source types
    const jobQueue = getJobQueue();
    jobQueue.enqueue(sourceId);

    return c.json(
      {
        id: sourceId,
        type: sourceType,
        title,
        author,
        year: year && !isNaN(year) ? year : 0,
        folderName: sourceId,
        progress: 0,
        hasMarkdown: false,
        hasOutline: false,
        hasCover: false,
        source: "upload",
        status: "pending",
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/** Update source metadata */
libraryRoutes.put("/sources/:sourceId", async (c) => {
  const sourceId = c.req.param("sourceId");
  try {
    const body = await c.req.json<{
      title?: string;
      author?: string;
      year?: number;
      metadata?: Record<string, any>;
    }>();

    const db = getDb();
    const existing = db
      .select()
      .from(sourcesTable)
      .where(eq(sourcesTable.id, sourceId))
      .get();

    if (!existing) {
      return c.json({ error: "Source not found" }, 404);
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    if (body.title !== undefined) updates.title = body.title.trim();
    if (body.author !== undefined) updates.author = body.author.trim();
    if (body.year !== undefined) updates.year = body.year;
    
    if (body.metadata !== undefined && body.metadata !== null) {
      const currentMeta = existing.metadata ? JSON.parse(existing.metadata) : {};
      const mergedMeta = { ...currentMeta, ...body.metadata };
      updates.metadata = JSON.stringify(mergedMeta);
    }

    db.update(sourcesTable)
      .set(updates)
      .where(eq(sourcesTable.id, sourceId))
      .run();

    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/** Delete an uploaded source */
libraryRoutes.delete("/sources/:sourceId", async (c) => {
  const sourceId = c.req.param("sourceId");

  try {
    const source = await getLibrary().getSource(sourceId);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    if (source.source === "system") {
      return c.json({ error: "Cannot delete system sources" }, 403);
    }

    // Delete DB row
    const db = getDb();
    db.delete(sourcesTable).where(eq(sourcesTable.id, sourceId)).run();

    // Delete directory
    const { rm } = await import("node:fs/promises");
    const sourceDir = join(dataPath, "sources", sourceId);
    await rm(sourceDir, { recursive: true, force: true });

    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** List all tags */
libraryRoutes.get("/tags", async (c) => {
  const tagList = getLibrary().listTags();
  return c.json({ tags: tagList });
});

/** Add a tag to a source */
libraryRoutes.post("/sources/:sourceId/tags", async (c) => {
  const sourceId = c.req.param("sourceId");
  const body = await c.req.json<{ tag: string }>();
  if (!body.tag || typeof body.tag !== "string") {
    return c.json({ error: "tag is required" }, 400);
  }
  await getLibrary().addTag(sourceId, body.tag);
  return c.json({ success: true });
});

/** Remove a tag from a source */
libraryRoutes.delete("/sources/:sourceId/tags/:tagName", async (c) => {
  const sourceId = c.req.param("sourceId");
  const tagName = decodeURIComponent(c.req.param("tagName"));
  await getLibrary().removeTag(sourceId, tagName);
  return c.json({ success: true });
});
