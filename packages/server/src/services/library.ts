import type { Source, SourceOutline, OutlineEntry } from "@pi-tree/shared";
import { readdir, readFile, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
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
  private libraryPath: string;
  private userBooksPath: string;
  private sourcesPath: string;
  private ingestion: BookIngestionService;
  private synced = false;

  constructor(dataPath?: string) {
    const dp =
      dataPath ??
      process.env.DATA_PATH ??
      join(process.env.HOME ?? "~", ".local", "share", "pi-tree");
    this.libraryPath = join(dp, "library");
    this.userBooksPath = join(dp, "books");
    this.sourcesPath = join(dp, "sources");
    
    // Ensure the directories exist
    mkdirSync(this.libraryPath, { recursive: true });
    mkdirSync(this.userBooksPath, { recursive: true });
    mkdirSync(this.sourcesPath, { recursive: true });
    
    this.ingestion = new BookIngestionService();
  }

  /** Candidate directories for a source, in resolution order: sources/ → library/ → books/ (legacy) */
  private candidateDirs(sourceId: string): string[] {
    return [
      join(this.sourcesPath, sourceId),
      join(this.libraryPath, sourceId),
      join(this.userBooksPath, sourceId),  // legacy fallback
    ];
  }

  getSourcesPath(): string {
    return this.sourcesPath;
  }

  getLibraryPath(): string {
    return this.libraryPath;
  }

  async listSources(): Promise<Source[]> {
    const entries = await readdir(this.libraryPath, { withFileTypes: true });
    const librarySources: Source[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const folderName = entry.name;
      const parsed = this.parseFolderName(folderName);
      if (!parsed) continue;

      const bookPath = join(this.libraryPath, folderName);

      const hasMarkdown = await this.exists(join(bookPath, "markdown"));
      const hasOutline = await this.exists(
        join(bookPath, "analysis", "outline.md"),
      );
      const hasCover = (
        await this.exists(join(bookPath, "cover.jpg")) ||
        await this.exists(join(bookPath, "cover.jpeg")) ||
        await this.exists(join(bookPath, "cover.png")) ||
        await this.exists(join(bookPath, "cover.webp")) ||
        await this.exists(join(bookPath, "cover.gif"))
      );

      librarySources.push({
        id: folderName,
        type: "book" as const,
        title: parsed.title,
        author: parsed.author,
        year: parsed.year,
        folderName,
        progress: 0, // TODO: Read from bookmark.md
        hasMarkdown,
        hasOutline,
        hasCover,
        source: "library",
      });
    }

    // Sync library sources to DB (idempotent) so they can be tagged
    if (!this.synced) {
      this.syncSourcesToDb(librarySources);
      this.synced = true;
    }

    const uploadedBooks = await this.ingestion.listUploadedBooks();
    
    // Fetch system-defined sources (like news feeds)
    const db = getDb();
    const systemSources = db.select().from(sourcesTable).where(eq(sourcesTable.source, "system")).all();
    const systemSourcesList: Source[] = systemSources.map(s => ({
      id: s.id,
      type: (s.type ?? "news") as Source["type"],
      title: s.title,
      author: s.author,
      year: s.year ?? new Date().getFullYear(),
      folderName: s.id,
      progress: 0,
      hasMarkdown: false,
      hasOutline: false,
      hasCover: false,
      source: "library",
      status: "ready"
    }));

    const allSources = [...librarySources, ...uploadedBooks, ...systemSourcesList];

    // Attach tags from DB
    const sourceIds = allSources.map((s) => s.id);
    const tagMap = this.getSourceTags(sourceIds);
    for (const src of allSources) {
      src.tags = tagMap.get(src.id) ?? [];
    }

    return allSources;
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
  // Source sync — upsert library sources into DB for tagging
  // ---------------------------------------------------------------------------

  private syncSourcesToDb(librarySources: Source[]): void {
    const db = getDb();
    const now = new Date().toISOString();

    for (const src of librarySources) {
      db.insert(sourcesTable)
        .values({
          id: src.id,
          type: "book",
          title: src.title,
          author: src.author,
          year: src.year,
          source: "library",
          status: "ready",
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
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
    if (!this.synced) {
      await this.listSources();
    }

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
    const searchPaths = this.candidateDirs(sourceId);
    const extensions = ["jpg", "jpeg", "png", "webp", "gif"];
    for (const basePath of searchPaths) {
      for (const ext of extensions) {
        const coverPath = join(basePath, `cover.${ext}`);
        if (await this.exists(coverPath)) {
          return coverPath;
        }
      }
    }
    return null;
  }

  async getOutline(sourceId: string): Promise<SourceOutline | null> {
    // 1. Try toc.json first (structured, zero-parsing)
    const tocJson = await this.loadTocJson(sourceId);
    if (tocJson) return tocJson;

    // 2. Fallback: parse outline.md (Navigation Map or heading extraction)
    const candidatePaths = this.candidateDirs(sourceId).map(d => join(d, "analysis", "outline.md"));

    for (const outlinePath of candidatePaths) {
      try {
        const content = await readFile(outlinePath, "utf-8");
        return this.parseOutline(sourceId, content);
      } catch {
        // Try next path
      }
    }
    return null;
  }

  /**
   * Load a structured toc.json if it exists.
   * This is the preferred source — emitted by the book-outline skill as clean JSON.
   */
  private async loadTocJson(sourceId: string): Promise<SourceOutline | null> {
    const candidatePaths = this.candidateDirs(sourceId).map(d => join(d, "analysis", "toc.json"));

    for (const tocPath of candidatePaths) {
      try {
        const raw = await readFile(tocPath, "utf-8");
        const data = JSON.parse(raw) as Array<{
          line: number;
          level: number;
          title: string;
        }>;

        if (!Array.isArray(data) || data.length === 0) continue;

        const entries: OutlineEntry[] = data.map((d) => ({
          line: d.line,
          level: d.level,
          title: d.title,
          children: [],
        }));

        const root = this.buildOutlineTree(entries);

        // Try to get summary from outline.md if it exists
        let summary = "";
        const outlineCandidates = this.candidateDirs(sourceId).map(d => join(d, "analysis", "outline.md"));
        for (const outlinePath of outlineCandidates) {
          try {
            const outlineContent = await readFile(outlinePath, "utf-8");
            summary = this.extractSummary(outlineContent.split("\n"));
            break;
          } catch {
            // Try next
          }
        }

        return { sourceId, summary, entries: root };
      } catch {
        // Try next path
      }
    }
    return null;
  }

  async readContent(
    sourceId: string,
    startLine: number,
    endLine: number,
  ): Promise<string | null> {
    const candidateDirs = this.candidateDirs(sourceId).map(d => join(d, "markdown"));

    for (const mdDir of candidateDirs) {
      try {
        const files = await readdir(mdDir);
        const mdFile = files.find((f) => f.endsWith(".md"));
        if (!mdFile) continue;

        const content = await readFile(join(mdDir, mdFile), "utf-8");
        const lines = content.split("\n");
        return lines.slice(startLine - 1, endLine).join("\n");
      } catch {
        // Try next path
      }
    }
    return null;
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
    const candidateDirs = this.candidateDirs(sourceId).map(d => join(d, "markdown"));

    for (const mdDir of candidateDirs) {
      try {
        const files = await readdir(mdDir);
        const mdFile = files.find((f) => f.endsWith(".md"));
        if (!mdFile) continue;

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
        // Try next path
      }
    }
    return null;
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
