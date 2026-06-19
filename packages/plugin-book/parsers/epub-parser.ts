import { EPub } from "epub2";
import TurndownService from "turndown";
import { extname } from "node:path";
import type { BookParser, ParseResult } from "./types.js";

export class EpubParser implements BookParser {
  readonly name = "epub";
  readonly extensions = [".epub"];

  async parse(filePath: string): Promise<ParseResult> {
    const epub = await EPub.createAsync(filePath);
    const td = new TurndownService({ headingStyle: "atx" });

    // Extract metadata
    const metadata: ParseResult["metadata"] = {
      title: epub.metadata.title ?? undefined,
      author: epub.metadata.creator ?? undefined,
      description: epub.metadata.description ?? undefined,
      language: epub.metadata.language ?? undefined,
    };

    if (epub.metadata.date) {
      const year = new Date(epub.metadata.date).getFullYear();
      if (!isNaN(year)) metadata.year = year;
    }

    // Walk spine/flow to get chapters in order
    const sections: string[] = [];
    for (const item of epub.flow) {
      if (!item.id) continue;
      try {
        const html = await epub.getChapterAsync(item.id);
        const md = td.turndown(html);
        if (md.trim().length > 0) {
          if (item.title) {
            sections.push(`## ${item.title}\n\n${md}`);
          } else {
            sections.push(md);
          }
        }
      } catch {
        // Skip chapters that fail to parse
      }
    }

    const markdown = sections.join("\n\n---\n\n");

    // Extract cover image
    let cover: ParseResult["cover"] | undefined;
    const coverId = epub.metadata.cover;
    if (coverId) {
      try {
        const [data, mimeType] = await epub.getImageAsync(coverId);
        if (data && data.length > 0) {
          let ext = ".jpg";
          if (mimeType === "image/png") ext = ".png";
          else if (mimeType === "image/webp") ext = ".webp";
          else if (mimeType === "image/gif") ext = ".gif";
          cover = { data, ext };
        }
      } catch {
        // No cover available
      }
    }

    return { markdown, metadata, cover };
  }
}
