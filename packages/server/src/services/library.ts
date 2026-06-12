import type { Source, SourceOutline, OutlineEntry } from "@pi-tree/shared";
import { readdir, readFile, stat } from "node:fs/promises";
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { getDb, sources as sourcesTable, tags as tagsTable, sourceTags } from "../db/index.js";
import { BookIngestionService } from "./book-ingestion.js";

/**
 * LibraryService — reads sources from DATA_PATH/library/ on disk.
 *
 * Place books in $DATA_PATH/library/ or upload them through the UI.
 * Reads the existing folder structure: book/, markdown/, analysis/, notes/.
 */
export class LibraryService {
  private sourcesPath: string;
  private ingestion: BookIngestionService;

  constructor(dataPath?: string) {
    const dp =
      dataPath ??
      process.env.DATA_PATH ??
      join(process.env.HOME ?? "~", ".local", "share", "pi-tree");
    this.sourcesPath = join(dp, "sources");
    
    mkdirSync(this.sourcesPath, { recursive: true });

    // One-time migration: move books/ and library/ into sources/
    this.migrateLegacyDirs(dp);
    
    this.ingestion = new BookIngestionService();
  }

  /**
   * Migrate legacy directories into sources/.
   * - books/: move directories as-is (already have DB rows)
   * - library/: parse folder names for metadata, insert DB rows, then move
   */
  private migrateLegacyDirs(dataPath: string): void {
    // --- Migrate books/ ---
    const booksPath = join(dataPath, "books");
    if (existsSync(booksPath)) {
      try {
        const entries = readdirSync(booksPath, { withFileTypes: true });
        let moved = 0;
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
          const src = join(booksPath, entry.name);
          const dest = join(this.sourcesPath, entry.name);
          if (existsSync(dest)) continue;
          renameSync(src, dest);
          moved++;
        }
        if (moved > 0) console.log(`[library] Migrated ${moved} source(s) from books/ → sources/`);
        if (readdirSync(booksPath).length === 0) rmSync(booksPath, { recursive: true, force: true });
      } catch { /* non-fatal */ }
    }

    // --- Migrate library/ ---
    const libraryPath = join(dataPath, "library");
    if (existsSync(libraryPath)) {
      try {
        const entries = readdirSync(libraryPath, { withFileTypes: true });
        const db = getDb();
        const now = new Date().toISOString();
        let moved = 0;
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
          const folderName = entry.name;
          const parsed = this.parseFolderName(folderName);
          if (!parsed) continue;

          // Ensure DB row exists
          db.insert(sourcesTable)
            .values({
              id: folderName,
              type: "book",
              title: parsed.title,
              author: parsed.author,
              year: parsed.year,
              source: "library",
              status: "ready",
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .run();

          // Move directory
          const src = join(libraryPath, folderName);
          const dest = join(this.sourcesPath, folderName);
          if (existsSync(dest)) continue;
          renameSync(src, dest);
          moved++;
        }
        if (moved > 0) console.log(`[library] Migrated ${moved} source(s) from library/ → sources/`);
        if (readdirSync(libraryPath).length === 0) rmSync(libraryPath, { recursive: true, force: true });
      } catch { /* non-fatal */ }
    }
  }

  /** Source directory path */
  private sourceDir(sourceId: string): string {
    return join(this.sourcesPath, sourceId);
  }

  getSourcesPath(): string {
    return this.sourcesPath;
  }

  async listSources(): Promise<Source[]> {
    const db = getDb();

    // All sources live in DB — uploaded, user-created, system, migrated
    const rows = db.select().from(sourcesTable).all();
    const result: Source[] = [];

    for (const row of rows) {
      const dir = this.sourceDir(row.id);

      const hasMarkdown = await this.exists(join(dir, "markdown"));
      const hasOutline =
        (await this.exists(join(dir, "analysis", "outline.md"))) ||
        (await this.exists(join(dir, "analysis", "toc.json")));

      let hasCover = false;
      for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
        if (await this.exists(join(dir, `cover.${ext}`))) {
          hasCover = true;
          break;
        }
      }

      result.push({
        id: row.id,
        type: (row.type ?? "book") as Source["type"],
        title: row.title,
        author: row.author,
        year: row.year ?? 0,
        folderName: row.id,
        progress: 0,
        hasMarkdown,
        hasOutline,
        hasCover,
        source: (row.source ?? "upload") as Source["source"],
        status: (row.status ?? "ready") as Source["status"],
        error: row.error ?? undefined,
      });
    }

    // Attach tags from DB
    const sourceIds = result.map((s) => s.id);
    const tagMap = this.getSourceTags(sourceIds);
    for (const src of result) {
      src.tags = tagMap.get(src.id) ?? [];
    }

    return result;
  }

  /**
   * Search and filter sources by query text and/or tags.
   */
  async searchSources(query?: string, filterTags?: string[]): Promise<Source[]> {
    let results = await this.listSources();

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.author.toLowerCase().includes(q),
      );
    }

    if (filterTags && filterTags.length > 0) {
      results = results.filter((s) => {
        const sourceTagSet = new Set(s.tags ?? []);
        return filterTags.every((t) => sourceTagSet.has(t));
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Tag management
  // ---------------------------------------------------------------------------

  /**
   * Get tags for a list of source IDs. Returns a map of sourceId → tag names.
   */
  getSourceTags(sourceIds: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (sourceIds.length === 0) return result;

    const db = getDb();
    // Use raw SQL for efficient join query
    const rows = db.all<{ source_id: string; name: string }>(
      sql`SELECT st.source_id, t.name
          FROM source_tags st
          JOIN tags t ON t.id = st.tag_id
          WHERE st.source_id IN (${sql.join(
            sourceIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
    );

    for (const row of rows) {
      const existing = result.get(row.source_id);
      if (existing) {
        existing.push(row.name);
      } else {
        result.set(row.source_id, [row.name]);
      }
    }
    return result;
  }

  /**
   * Add a tag to a source. Creates the tag if it doesn't exist.
   */
  async addTag(sourceId: string, tagName: string): Promise<void> {
    const db = getDb();
    const name = tagName.toLowerCase().trim();
    if (!name) return;

    // Ensure the source exists in DB (sync if needed)
    await this.listSources();

    // Create tag if it doesn't exist
    db.insert(tagsTable)
      .values({ name, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();

    // Get the tag id
    const tag = db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.name, name))
      .get();
    if (!tag) return;

    // Insert junction row
    db.run(
      sql`INSERT OR IGNORE INTO source_tags (source_id, tag_id) VALUES (${sourceId}, ${tag.id})`,
    );
  }

  /**
   * Remove a tag from a source. Cleans up orphaned tags.
   */
  async removeTag(sourceId: string, tagName: string): Promise<void> {
    const db = getDb();
    const name = tagName.toLowerCase().trim();

    const tag = db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.name, name))
      .get();
    if (!tag) return;

    // Remove junction row
    db.run(
      sql`DELETE FROM source_tags WHERE source_id = ${sourceId} AND tag_id = ${tag.id}`,
    );

    // Clean up orphaned tag (no sources reference it)
    const usage = db
      .select({ count: sql<number>`count(*)` })
      .from(sourceTags)
      .where(eq(sourceTags.tagId, tag.id))
      .get();
    if (usage && usage.count === 0) {
      db.delete(tagsTable).where(eq(tagsTable.id, tag.id)).run();
    }
  }

  /**
   * List all unique tag names.
   */
  listTags(): string[] {
    const db = getDb();
    const rows = db
      .select({ name: tagsTable.name })
      .from(tagsTable)
      .orderBy(tagsTable.name)
      .all();
    return rows.map((r) => r.name);
  }

  async getSource(sourceId: string): Promise<Source | null> {
    const sources = await this.listSources();
    return sources.find((s) => s.id === sourceId) ?? null;
  }

  async getCoverPath(sourceId: string): Promise<string | null> {
    const basePath = this.sourceDir(sourceId);
    const extensions = ["jpg", "jpeg", "png", "webp", "gif"];
    for (const ext of extensions) {
      const coverPath = join(basePath, `cover.${ext}`);
      if (await this.exists(coverPath)) {
        return coverPath;
      }
    }
    return null;
  }

  async getOutline(sourceId: string): Promise<SourceOutline | null> {
    // 1. Try toc.json first (structured, zero-parsing)
    const tocJson = await this.loadTocJson(sourceId);
    if (tocJson) return tocJson;

    // 2. Fallback: parse outline.md (Navigation Map or heading extraction)
    const outlinePath = join(this.sourceDir(sourceId), "analysis", "outline.md");

    try {
      const content = await readFile(outlinePath, "utf-8");
      return this.parseOutline(sourceId, content);
    } catch {
      return null;
    }
  }

  /**
   * Load a structured toc.json if it exists.
   * This is the preferred source — emitted by the book-outline skill as clean JSON.
   */
  private async loadTocJson(sourceId: string): Promise<SourceOutline | null> {
    const tocPath = join(this.sourceDir(sourceId), "analysis", "toc.json");

    try {
      const raw = await readFile(tocPath, "utf-8");
      const data = JSON.parse(raw) as Array<{
        line: number;
        level: number;
        title: string;
      }>;

      if (!Array.isArray(data) || data.length === 0) return null;

      const entries: OutlineEntry[] = data.map((d) => ({
        line: d.line,
        level: d.level,
        title: d.title,
        children: [],
      }));

      const root = this.buildOutlineTree(entries);

      // Try to get summary from outline.md if it exists
      let summary = "";
      const outlinePath2 = join(this.sourceDir(sourceId), "analysis", "outline.md");
      try {
        const outlineContent = await readFile(outlinePath2, "utf-8");
        summary = this.extractSummary(outlineContent.split("\n"));
      } catch {
        // No outline.md
      }

      return { sourceId, summary, entries: root };
    } catch {
      return null;
    }
  }

  async readContent(
    sourceId: string,
    startLine: number,
    endLine: number,
  ): Promise<string | null> {
    const mdDir = join(this.sourceDir(sourceId), "markdown");

    try {
      const files = await readdir(mdDir);
      const mdFile = files.find((f) => f.endsWith(".md"));
      if (!mdFile) return null;

      const content = await readFile(join(mdDir, mdFile), "utf-8");
      const lines = content.split("\n");
      return lines.slice(startLine - 1, endLine).join("\n");
    } catch {
      return null;
    }
  }

  /**
   * Extract headings as a lightweight TOC.
   *
   * Priority:
   *  1. toc.json (structured, emitted by book-outline skill)
   *  2. AI-generated Navigation Map from outline.md (clean titles, correct lines)
   *  3. Regex extraction from raw markdown (fallback)
   */
  async getHeadings(
    sourceId: string,
  ): Promise<Array<{ line: number; level: number; title: string }> | null> {
    // 1. Try outline's Navigation Map first (AI-cleaned, reliable)
    const outline = await this.getOutline(sourceId);
    if (outline && outline.entries.length > 0) {
      return this.flattenOutline(outline.entries);
    }

    // 2. Fallback: regex from raw markdown
    return this.extractHeadingsFromMarkdown(sourceId);
  }

  /**
   * Flatten an OutlineEntry tree into a flat heading list.
   */
  private flattenOutline(
    entries: OutlineEntry[],
  ): Array<{ line: number; level: number; title: string }> {
    const result: Array<{ line: number; level: number; title: string }> = [];

    const walk = (nodes: OutlineEntry[]) => {
      for (const node of nodes) {
        result.push({ line: node.line, level: node.level, title: node.title });
        if (node.children.length > 0) walk(node.children);
      }
    };

    walk(entries);
    // Sort by line number to ensure correct order after tree flattening
    result.sort((a, b) => a.line - b.line);
    return result;
  }

  /**
   * Regex-based heading extraction from raw markdown.
   * Used as fallback when no outline Navigation Map is available.
   */
  private async extractHeadingsFromMarkdown(
    sourceId: string,
  ): Promise<Array<{ line: number; level: number; title: string }> | null> {
    const mdDir = join(this.sourceDir(sourceId), "markdown");

    try {
      const files = await readdir(mdDir);
      const mdFile = files.find((f) => f.endsWith(".md"));
      if (!mdFile) return null;

      const content = await readFile(join(mdDir, mdFile), "utf-8");
      const lines = content.split("\n");
      const headings: Array<{ line: number; level: number; title: string }> = [];

      let inCodeBlock = false;
      for (let i = 0; i < lines.length; i++) {
        // Skip lines inside fenced code blocks
        if (/^(`{3,}|~{3,})/.test(lines[i])) {
          inCodeBlock = !inCodeBlock;
          continue;
        }
        if (inCodeBlock) continue;

        const match = lines[i].match(/^(#{1,6})\s+(.+)/);
        if (match) {
          const title = this.cleanHeadingTitle(match[2]);
          if (title.length > 0 && !this.isNoiseHeading(title)) {
            headings.push({
              line: i + 1,
              level: match[1].length,
              title,
            });
          }
        }
      }

      return headings;
    } catch {
      return null;
    }
  }

  /**
   * Clean conversion artifacts from heading text.
   * Handles Pandoc/Calibre/Sigil markup that survives ebook-to-markdown conversion.
   */
  private cleanHeadingTitle(raw: string): string {
    return (
      raw
        // Remove Pandoc span/id markers: []{#id .class}  or  [text]{.class}
        .replace(/\[([^\]]*)\]\{[^}]+\}/g, "$1")
        // Remove trailing {.class-name} attributes
        .replace(/\s*\{[^}]+\}\s*$/g, "")
        // Remove empty [] markers
        .replace(/\[\]\s*/g, "")
        // Remove bold **markers**
        .replace(/\*\*/g, "")
        // Remove inline HTML tags like <big>, </big>
        .replace(/<[^>]+>/g, "")
        // Remove leading bullet markers like ◆
        .replace(/^[◆●■►▸▪]\s*/g, "")
        // Remove escaped pipe: 7\|
        .replace(/\\\|/g, "|")
        // Collapse whitespace (fullwidth + regular spaces)
        .replace(/[\s\u3000]+/g, " ")
        .trim()
    );
  }

  /**
   * Filter out known non-content headings (ads, metadata, noise).
   */
  private isNoiseHeading(title: string): boolean {
    const NOISE_PATTERNS = [
      /^continue reading/i,
      /^读累了/,
      /^index$/i,
      /^copyright$/i,
      /^isbn/i,
    ];
    return NOISE_PATTERNS.some((p) => p.test(title));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseFolderName(
    name: string,
  ): { title: string; author: string; year: number } | null {
    // Pattern: Title_Author_Year  or  Title Author_Author_Year
    const parts = name.split("_");
    if (parts.length < 3) return null;

    const year = parseInt(parts[parts.length - 1], 10);
    if (isNaN(year)) return null;

    const author = parts[parts.length - 2];
    const title = parts.slice(0, -2).join(" ");

    return { title, author, year };
  }

  /**
   * Parse a source's outline.md, preferring the Navigation Map code block
   * (L-prefixed line entries) produced by the book-outline skill.
   * Falls back to extracting headings from the outline markdown itself.
   */
  private parseOutline(sourceId: string, content: string): SourceOutline {
    const lines = content.split("\n");

    // 1. Try to extract from Navigation Map code block (L<line> format)
    const navMapEntries = this.parseNavigationMap(lines);

    if (navMapEntries.length > 0) {
      const root = this.buildOutlineTree(navMapEntries);
      return {
        sourceId,
        summary: this.extractSummary(lines),
        entries: root,
      };
    }

    // 2. Fallback: extract headings from the outline markdown itself
    const entries: OutlineEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (match) {
        entries.push({
          line: i + 1,
          level: match[1].length,
          title: match[2].trim(),
          children: [],
        });
      }
    }

    const root = this.buildOutlineTree(entries);
    return {
      sourceId,
      summary: this.extractSummary(lines),
      entries: root,
    };
  }

  /**
   * Parse the Navigation Map code block from outline.md.
   * Looks for a fenced code block after a "Navigation Map" heading,
   * containing lines like: L156   ## Part 1: Title (L256–L7207)
   */
  private parseNavigationMap(lines: string[]): OutlineEntry[] {
    const entries: OutlineEntry[] = [];

    // Find the Navigation Map section
    let navMapHeaderIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,3}\s+(Navigation Map|导航图)/i.test(lines[i])) {
        navMapHeaderIdx = i;
        break;
      }
    }
    if (navMapHeaderIdx === -1) return [];

    // Find the code block after the header
    let inCodeBlock = false;
    for (let i = navMapHeaderIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith("```")) {
        if (inCodeBlock) break; // closing fence — done
        inCodeBlock = true;
        continue;
      }

      if (!inCodeBlock) continue;

      // Parse: L156   ## Part 1: Title (L256–L7207)
      const match = trimmed.match(/^L(\d+)\s+(#{1,6})\s+(.+)/);
      if (match) {
        const title = match[3]
          // Remove trailing line-range annotations like (L256–L7207)
          .replace(/\s*\(L\d+[–\-]L\d+\)\s*$/, "")
          .trim();

        if (title.length > 0) {
          entries.push({
            line: parseInt(match[1], 10),
            level: match[2].length,
            title,
            children: [],
          });
        }
      }
    }

    return entries;
  }

  /**
   * Extract the one-line summary from outline.md content.
   */
  private extractSummary(lines: string[]): string {
    let inSummary = false;
    for (const line of lines) {
      if (/^#{1,3}\s+One-Line Summary/i.test(line)) {
        inSummary = true;
        continue;
      }
      if (inSummary) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          return trimmed;
        }
        if (trimmed.startsWith("#")) break; // next section
      }
    }
    return "";
  }

  private buildOutlineTree(entries: OutlineEntry[]): OutlineEntry[] {
    if (entries.length === 0) return [];

    const result: OutlineEntry[] = [];
    const stack: OutlineEntry[] = [];

    for (const entry of entries) {
      while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        result.push(entry);
      } else {
        stack[stack.length - 1].children.push(entry);
      }

      stack.push(entry);
    }

    return result;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
