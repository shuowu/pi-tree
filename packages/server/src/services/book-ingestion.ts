import type { Book } from "@pi-books/shared";
import { eq, sql } from "drizzle-orm";
import { mkdir, writeFile, rm, readdir, stat, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { getDb, books } from "../db/index.js";
import { getParser } from "@pi-books/extension/parsers";
import { createAgentSession, SessionManager, AuthStorage, ModelRegistry, DefaultResourceLoader, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getServerConfig } from "../config.js";

const dataPath =
  process.env.DATA_PATH ??
  join(process.env.HOME ?? "~", ".local", "share", "pi-books");

const booksBasePath = join(dataPath, "books");

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class BookIngestionService {
  async addBook(
    file: Buffer,
    filename: string,
    meta: { title: string; author: string; year?: number },
  ): Promise<Book> {
    const db = getDb();
    const ext = extname(filename).toLowerCase();

    // Generate bookId
    const parts = [meta.title, meta.author];
    if (meta.year) parts.push(String(meta.year));
    let baseId = slugify(parts.join("-"));
    let bookId = baseId;
    let suffix = 1;

    // Check for collision
    while (true) {
      const existing = db.select().from(books).where(eq(books.id, bookId)).get();
      if (!existing) break;
      suffix++;
      bookId = `${baseId}-${suffix}`;
    }

    // Create directory structure
    const bookDir = join(booksBasePath, bookId);
    const markdownDir = join(bookDir, "markdown");
    await mkdir(markdownDir, { recursive: true });

    // Save original file
    const originalPath = join(bookDir, `original${ext}`);
    await writeFile(originalPath, file);

    // Insert DB row
    const now = new Date().toISOString();
    db.insert(books)
      .values({
        id: bookId,
        title: meta.title,
        author: meta.author,
        year: meta.year ?? null,
        sourceFormat: ext.slice(1),
        status: "pending",
        originalFilename: filename,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Enqueue background processing job
    import("./job-queue.js").then((mod) => {
      mod.JobQueueService.getInstance().createJob(bookId).catch((err) => {
        console.error(`[book-ingestion] Failed to enqueue job for ${bookId}:`, err);
      });
    });

    return {
      id: bookId,
      title: meta.title,
      author: meta.author,
      year: meta.year ?? 0,
      folderName: bookId,
      progress: 0,
      hasMarkdown: false,
      hasOutline: false,
      hasCover: false,
      source: "upload",
      status: "pending",
    };
  }

  async processBookWithJob(bookId: string, jobId: string, queue: any): Promise<void> {
    const db = getDb();
    const row = db.select().from(books).where(eq(books.id, bookId)).get();
    if (!row) throw new Error(`Book ${bookId} not found in DB`);

    const now = () => new Date().toISOString();

    // Update status to processing
    db.update(books)
      .set({ status: "processing", updatedAt: now() })
      .where(eq(books.id, bookId))
      .run();

    const bookDir = join(booksBasePath, bookId);
    const originalPath = join(bookDir, `original.${row.sourceFormat}`);

    try {
      queue.updateProgress(jobId, "parsing_file", 10);
      const parser = getParser(row.originalFilename);
      if (!parser) {
        throw new Error(`No parser for format: ${row.sourceFormat}`);
      }

      const result = await parser.parse(originalPath);

      queue.updateProgress(jobId, "writing_markdown", 30);
      // Write markdown
      const mdPath = join(bookDir, "markdown", `${bookId}.md`);
      await writeFile(mdPath, result.markdown, "utf-8");

      // Write cover if present
      if (result.cover) {
        const coverPath = join(bookDir, `cover${result.cover.ext}`);
        await writeFile(coverPath, result.cover.data);
      }

      // Generate outline and summary
      queue.updateProgress(jobId, "generating_outline", 45);
      
      const analysisDir = join(bookDir, "analysis");
      await mkdir(analysisDir, { recursive: true });

      // Build headings for toc.json using a robust parser that matches standard markdown headings
      // as well as plain-text headers (e.g. Chapter 3, 3.1 Introduction)
      const lines = result.markdown.split("\n");
      const headings: Array<{ line: number; level: number; title: string }> = [];
      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i].trim();
        if (/^(`{3,}|~{3,})/.test(rawLine)) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (inCodeBlock) continue;

        // 1. Standard markdown headings
        const mdMatch = rawLine.match(/^(#{1,6})\s+(.+)/);
        if (mdMatch) {
          let title = mdMatch[2]
            .replace(/\[\]\{#[^}]+\}/g, "")
            .replace(/\{[^}]+\}/g, "")
            .replace(/<[^>]+>/g, "")
            .replace(/[\*\_◆]+/g, "")
            .trim();
          if (title.length > 0) {
            headings.push({
              line: i + 1,
              level: mdMatch[1].length,
              title,
            });
          }
          continue;
        }

        // 2. Plain-text Chapter headings, e.g. "Chapter 3"
        const chapterMatch = rawLine.match(/^Chapter\s+(\d+)\s*$/i);
        if (chapterMatch) {
          let title = "";
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const nextLine = lines[j].trim();
            if (nextLine.length > 0) {
              title = nextLine;
              break;
            }
          }
          const cleanTitle = `Chapter ${chapterMatch[1]}${title ? " – " + title : ""}`;
          headings.push({
            line: i + 1,
            level: 1,
            title: cleanTitle,
          });
          continue;
        }

        // 3. Plain-text Section headings, e.g. "3.1 Introduction: ..."
        const sectionMatch = rawLine.match(/^(\d+)\.(\d+)\s+(.+)/);
        if (sectionMatch) {
          const cleanTitle = `${sectionMatch[1]}.${sectionMatch[2]} ${sectionMatch[3].trim()}`;
          headings.push({
            line: i + 1,
            level: 2,
            title: cleanTitle,
          });
          continue;
        }

        // 4. Plain-text Introduction / Conclusion / Summary / References
        if (/^(Introduction|Conclusion|Summary|References)$/i.test(rawLine)) {
          headings.push({
            line: i + 1,
            level: 1,
            title: rawLine,
          });
          continue;
        }
      }

      // Save candidate toc.json
      await writeFile(
        join(analysisDir, "toc.json"),
        JSON.stringify(headings, null, 2),
        "utf-8"
      );

      const outlinePrompt = `You are a Pi agent processing the book with ID "${bookId}" in your current directory.

We have programmatically generated a candidate table of contents in "analysis/toc.json".
Note that "analysis/toc.json" might contain early front-matter Table of Contents mentions (e.g., chapters listed very close together at the beginning of the book between lines 50 and 450) as well as the actual body chapters starting later (e.g., Chapter 1 starting around line 525, Chapter 2 around line 688, etc.).

Please:
1. Read "analysis/toc.json". Clean and refine it:
   - Remove any front-matter Table of Contents entries (which point to the early summary page). Keep only the actual body chapters and their subsections.
   - Deduplicate entries: if you see a duplicate "Chapter N" and "Chapter N - Title" close to each other, merge them (keep the earliest line number and clean title).
   - Ensure the structure is correct and sequential.
   - Save the refined "analysis/toc.json" using the "write" tool.
2. Follow the "book-outline" skill to generate the "analysis/outline.md" file using the refined "analysis/toc.json". Save it using the "write" tool.

Report success when both "analysis/toc.json" and "analysis/outline.md" are written.
Do NOT use the "read" tool to read the entire markdown file, to prevent bloating your context and causing API gateway timeouts.`;

      console.log(`[book-ingestion] Launching Pi Agent to refine TOC and generate outline...`);
      await this.runAgentSession(bookDir, outlinePrompt);

      // Generate summary.md
      queue.updateProgress(jobId, "generating_summary", 75);

      const summaryPrompt = `You are a Pi agent processing the book with ID "${bookId}" in your current directory.

Please follow the "book-analysis" skill to generate the "analysis/summary.md" file, using the refined table of contents in "analysis/toc.json". Save it using the "write" tool.

Report success when "analysis/summary.md" is written.
Do NOT use the "read" tool to read the entire markdown file, to prevent bloating your context and causing API gateway timeouts.`;

      console.log(`[book-ingestion] Launching Pi Agent to generate summary...`);
      await this.runAgentSession(bookDir, summaryPrompt);

      // Update DB with success
      db.update(books)
        .set({
          status: "ready",
          error: null,
          title: result.metadata.title ?? row.title,
          author: result.metadata.author ?? row.author,
          year: result.metadata.year ?? row.year,
          updatedAt: now(),
        })
        .where(eq(books.id, bookId))
        .run();

      console.log(`[book-ingestion] Successfully processed ${bookId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[book-ingestion] Failed to process ${bookId}:`, message);
      try {
        db.update(books)
          .set({
            status: "failed",
            error: message,
            updatedAt: now(),
          })
          .where(eq(books.id, bookId))
          .run();
        console.log(`[book-ingestion] Updated DB record status to failed for book ${bookId}`);
      } catch (dbErr) {
        console.error(`[book-ingestion] Failed to update book status in DB after ingestion failure:`, dbErr);
      }
      throw err;
    }
  }

  async processBook(bookId: string): Promise<void> {
    // Legacy fallback, redirects to queue
    import("./job-queue.js").then((mod) => {
      mod.JobQueueService.getInstance().createJob(bookId).catch((err) => {
        console.error(`[book-ingestion] Failed to process ${bookId}:`, err);
      });
    });
  }

  async generateOutlineAndSummary(
    bookId: string,
    meta: { title: string; author: string; year?: number },
  ): Promise<void> {
    const bookDir = join(booksBasePath, bookId);
    const mdPath = join(bookDir, "markdown", `${bookId}.md`);
    
    // Ensure md file exists
    if (!(await exists(mdPath))) {
      throw new Error(`Markdown file not found at ${mdPath}`);
    }

    const content = await readFile(mdPath, "utf-8");
    const lines = content.split("\n");
    const headings: Array<{ line: number; level: number; title: string }> = [];

    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].trim();
      if (/^(`{3,}|~{3,})/.test(rawLine)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      // 1. Standard markdown headings
      const mdMatch = rawLine.match(/^(#{1,6})\s+(.+)/);
      if (mdMatch) {
        let title = mdMatch[2]
          .replace(/\[\]\{#[^}]+\}/g, "")
          .replace(/\{[^}]+\}/g, "")
          .replace(/<[^>]+>/g, "")
          .replace(/[\*\_◆]+/g, "")
          .trim();
        if (title.length > 0) {
          headings.push({
            line: i + 1,
            level: mdMatch[1].length,
            title,
          });
        }
        continue;
      }

      // 2. Plain-text Chapter headings, e.g. "Chapter 3"
      const chapterMatch = rawLine.match(/^Chapter\s+(\d+)\s*$/i);
      if (chapterMatch) {
        let title = "";
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (nextLine.length > 0) {
            title = nextLine;
            break;
          }
        }
        const cleanTitle = `Chapter ${chapterMatch[1]}${title ? " – " + title : ""}`;
        headings.push({
          line: i + 1,
          level: 1,
          title: cleanTitle,
        });
        continue;
      }

      // 3. Plain-text Section headings, e.g. "3.1 Introduction: ..."
      const sectionMatch = rawLine.match(/^(\d+)\.(\d+)\s+(.+)/);
      if (sectionMatch) {
        const cleanTitle = `${sectionMatch[1]}.${sectionMatch[2]} ${sectionMatch[3].trim()}`;
        headings.push({
          line: i + 1,
          level: 2,
          title: cleanTitle,
        });
        continue;
      }

      // 4. Plain-text Introduction / Conclusion / Summary / References
      if (/^(Introduction|Conclusion|Summary|References)$/i.test(rawLine)) {
        headings.push({
          line: i + 1,
          level: 1,
          title: rawLine,
        });
        continue;
      }
    }

    const analysisDir = join(bookDir, "analysis");
    await mkdir(analysisDir, { recursive: true });

    // 1. Save toc.json
    await writeFile(
      join(analysisDir, "toc.json"),
      JSON.stringify(headings, null, 2),
      "utf-8"
    );
    console.log(`[book-ingestion] Generated candidate toc.json programmatically for ${bookId}`);

    // 2. Delegate outline.md and summary.md generation to Pi Agent with skills
    const prompt = `You are a Pi agent helping to process the book with ID "${bookId}" in your current directory.

We have programmatically generated the candidate table of contents in "analysis/toc.json" for you.

Please:
1. Read "analysis/toc.json". Clean and refine it:
   - Remove any front-matter Table of Contents entries (which point to the early summary page). Keep only the actual body chapters and their subsections.
   - Deduplicate entries: if you see a duplicate "Chapter N" and "Chapter N - Title" close to each other, merge them (keep the earliest line number and clean title).
   - Ensure the structure is correct and sequential.
   - Save the refined "analysis/toc.json" using the "write" tool.
2. Run the "book-outline" skill to generate the "analysis/outline.md" file using the refined "analysis/toc.json".
   Make sure the line numbers in the "Navigation Map" section of "analysis/outline.md" EXACTLY match the line numbers in the refined "analysis/toc.json". Save it using the "write" tool.
3. Run the "book-analysis" skill to generate the "analysis/summary.md" file. Save it using the "write" tool.

When you are done writing both files, report success.
Do NOT use the "read" tool to read the entire markdown file, to prevent bloating your context and causing API gateway timeouts.`;

    console.log(`[book-ingestion] Launching Pi Agent session to run book-outline and book-analysis skills for ${bookId}...`);
    const agentResponse = await this.runAgentSession(bookDir, prompt);
    console.log(`[book-ingestion] Pi Agent finished processing:`, agentResponse.trim());
  }

  private async runAgentSession(cwd: string, prompt: string): Promise<string> {
    const serverConfig = getServerConfig();
    const repoRoot = join(import.meta.dirname, "../../../..");
    const agentDir = getAgentDir();

    let authStorage: AuthStorage;
    if (serverConfig.apiKey && serverConfig.provider) {
      authStorage = AuthStorage.inMemory();
      authStorage.setRuntimeApiKey(serverConfig.provider, serverConfig.apiKey);
    } else {
      authStorage = AuthStorage.create();
    }

    const modelRegistry = ModelRegistry.create(authStorage);

    if (serverConfig.apiKey && serverConfig.provider && serverConfig.baseUrl) {
      modelRegistry.registerProvider(serverConfig.provider, {
        baseUrl: serverConfig.baseUrl,
      });
    }

    const resourceLoader = new DefaultResourceLoader({
      cwd: repoRoot,
      agentDir,
      additionalSkillPaths: [
        join(import.meta.dirname, "../../../extension/skills"),
      ],
    });
    await resourceLoader.reload();

    const modelId = serverConfig.readingModel;
    const allModels = modelRegistry.getAll();
    const selectedModel = allModels.find((m) => m.id === modelId);

    const { session } = await createAgentSession({
      cwd,
      tools: ["read", "write", "grep", "find", "ls"],
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.create(repoRoot),
      authStorage,
      modelRegistry,
      ...(selectedModel ? { model: selectedModel } : {}),
    });

    try {
      let fullResponse = "";
      const unsubscribe = session.subscribe(async (event) => {
        console.log(`[agent-event-raw]`, JSON.stringify(event));
        if (event.type === "message_update") {
          const assistant = event.assistantMessageEvent;
          if (assistant?.type === "text_delta" && assistant.delta) {
            fullResponse += assistant.delta;
            process.stdout.write(assistant.delta);
          } else if (assistant?.type === "toolcall_start" && (assistant as any).toolCall) {
            console.log(`\n[agent-tool-call] Starting tool: ${(assistant as any).toolCall.name} with args: ${JSON.stringify((assistant as any).toolCall.arguments)}`);
          } else if (assistant?.type === "toolcall_end" && (assistant as any).toolCall) {
            console.log(`\n[agent-tool-call] Finished tool: ${(assistant as any).toolCall.name}`);
          }
        }
      });

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            reject(new Error("Pi Agent session timed out after 10 minutes"));
          }, 10 * 60 * 1000);
          timer.unref();
        });
        await Promise.race([
          session.prompt(prompt),
          timeoutPromise
        ]);
      } finally {
        unsubscribe();
        console.log("\n[book-ingestion] Agent session prompt completed.");
      }

      return fullResponse;
    } finally {
      session.dispose();
    }
  }

  async deleteBook(bookId: string): Promise<void> {
    const db = getDb();

    // Delete DB row
    db.delete(books).where(eq(books.id, bookId)).run();

    // Delete directory
    const bookDir = join(booksBasePath, bookId);
    await rm(bookDir, { recursive: true, force: true });
  }

  async listUploadedBooks(): Promise<Book[]> {
    const db = getDb();
    const rows = db.select().from(books).where(
      sql`${books.source} != 'library' OR ${books.source} IS NULL`
    ).all();
    const result: Book[] = [];

    for (const row of rows) {
      const bookDir = join(booksBasePath, row.id);

      const hasMarkdown = await exists(join(bookDir, "markdown"));
      const hasOutline =
        (await exists(join(bookDir, "analysis", "outline.md"))) ||
        (await exists(join(bookDir, "analysis", "toc.json")));

      let hasCover = false;
      for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
        if (await exists(join(bookDir, `cover.${ext}`))) {
          hasCover = true;
          break;
        }
      }

      result.push({
        id: row.id,
        title: row.title,
        author: row.author,
        year: row.year ?? 0,
        folderName: row.id,
        progress: 0,
        hasMarkdown,
        hasOutline,
        hasCover,
        source: "upload",
        status: row.status as Book["status"],
        error: row.error ?? undefined,
      });
    }

    return result;
  }

  getUploadedBookPath(bookId: string): string {
    return join(booksBasePath, bookId);
  }
}
