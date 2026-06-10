import { Hono } from "hono";
import { LibraryService } from "../services/library.js";
import { BookIngestionService } from "../services/book-ingestion.js";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { JobQueueService } from "../services/job-queue.js";

export const libraryRoutes = new Hono();

let _library: LibraryService | null = null;
let _bookIngestion: BookIngestionService | null = null;

function getLibrary(): LibraryService {
  if (!_library) {
    _library = new LibraryService();
  }
  return _library;
}

function getBookIngestion(): BookIngestionService {
  if (!_bookIngestion) {
    _bookIngestion = new BookIngestionService();
  }
  return _bookIngestion;
}

/** @internal — used by tests to reset singletons */
export function _resetLibraryServices(): void {
  _library = null;
  _bookIngestion = null;
}

/** List all sources in the library (with optional search/tag filter) */
libraryRoutes.get("/sources", async (c) => {
  const search = c.req.query("search");
  const tagsParam = c.req.query("tags");
  const filterTags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;

  const sources =
    search || (filterTags && filterTags.length > 0)
      ? await getLibrary().searchSources(search, filterTags)
      : await getLibrary().listSources();
  return c.json({ sources });
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

/** Upload a new book */
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

    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const filename = (file as File).name ?? "upload.epub";

    const source = await getBookIngestion().addBook(buffer, filename, {
      title,
      author,
      year: year && !isNaN(year) ? year : undefined,
    });

    return c.json(source, 201);
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

    if (source.source === "library") {
      return c.json({ error: "Cannot delete library sources" }, 403);
    }

    await getBookIngestion().deleteBook(sourceId);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/** Process an uploaded source (enqueue job to generate outline and summary) */
libraryRoutes.post("/sources/:sourceId/process", async (c) => {
  const sourceId = c.req.param("sourceId");
  try {
    const source = await getLibrary().getSource(sourceId);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    const job = await JobQueueService.getInstance().createJob(sourceId);
    return c.json({ success: true, job });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/** Get the latest background job for a source */
libraryRoutes.get("/sources/:sourceId/job", async (c) => {
  const sourceId = c.req.param("sourceId");
  const job = JobQueueService.getInstance().getLatestJobForSource(sourceId);
  return c.json({ job });
});

/** Get all background jobs */
libraryRoutes.get("/jobs", async (c) => {
  try {
    const jobs = JobQueueService.getInstance().getAllJobs();
    const sourceList = await getLibrary().listSources();
    const sourceMap = new Map(sourceList.map((s) => [s.id, s]));

    const jobsWithSources = jobs.map((job) => {
      const source = sourceMap.get(job.sourceId);
      return {
        ...job,
        bookTitle: source?.title || job.sourceId,
        bookAuthor: source?.author || "Unknown",
      };
    });

    return c.json({ jobs: jobsWithSources });
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
