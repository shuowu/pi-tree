import { readFile } from "node:fs/promises";
import TurndownService from "turndown";
import type { BookParser, ParseResult } from "./types.js";

export class MobiParser implements BookParser {
  readonly name = "mobi";
  readonly extensions = [".mobi", ".azw", ".azw3"];

  async parse(filePath: string): Promise<ParseResult> {
    const { initMobiFile, initKf8File } = await import(
      "@lingo-reader/mobi-parser"
    );
    const td = new TurndownService({ headingStyle: "atx" });
    const fileData = await readFile(filePath);
    const uint8 = new Uint8Array(fileData);

    // Try KF8 first (newer format), fall back to MOBI
    let parser: Awaited<ReturnType<typeof initKf8File>> | Awaited<ReturnType<typeof initMobiFile>>;
    try {
      parser = await initKf8File(uint8);
    } catch {
      parser = await initMobiFile(uint8);
    }

    const meta = parser.getMetadata();
    const metadata: ParseResult["metadata"] = {
      title: meta.title ?? undefined,
      author: meta.author?.[0] ?? undefined,
      description: meta.description ?? undefined,
      language: meta.language ?? undefined,
    };

    if (meta.published) {
      const year = new Date(meta.published).getFullYear();
      if (!isNaN(year)) metadata.year = year;
    }

    // Walk spine and extract chapters
    const spine = parser.getSpine();
    const sections: string[] = [];

    for (const item of spine) {
      try {
        const chapter = parser.loadChapter(item.id);
        if (chapter && chapter.html) {
          const md = td.turndown(chapter.html);
          if (md.trim().length > 0) {
            sections.push(md);
          }
        }
      } catch {
        // Skip chapters that fail
      }
    }

    const markdown = sections.join("\n\n---\n\n");

    parser.destroy();

    return { markdown, metadata };
  }
}
