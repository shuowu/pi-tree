import { EPub } from "epub2";
import TurndownService from "turndown";
import { extname } from "node:path";
import { open, stat } from "node:fs/promises";
import type { BookParser, ParseResult } from "./types.js";

const ZIP_EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP64_EOCD_SIG = Buffer.from([0x50, 0x4b, 0x06, 0x06]);
// EOCD record is 22 bytes + up to 65535 bytes of zip comment
const ZIP_EOCD_SEARCH_WINDOW = 65_557;

/**
 * Cheap structural check before handing the file to epub2, which reports every
 * zip failure as a misleading "Invalid/missing file" error.
 */
async function assertValidEpub(filePath: string): Promise<void> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    throw new Error(`EPUB file not found: ${filePath}`);
  }

  const fh = await open(filePath, "r");
  try {
    const head = Buffer.alloc(2);
    if (size >= 2) await fh.read(head, 0, 2, 0);
    if (size < 22 || head[0] !== 0x50 || head[1] !== 0x4b) {
      throw new Error(
        "This EPUB is not a valid ZIP archive — the file may be corrupt or mislabeled. Try re-downloading it.",
      );
    }

    const tailLen = Math.min(size, ZIP_EOCD_SEARCH_WINDOW);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    if (!tail.includes(ZIP_EOCD_SIG) && !tail.includes(ZIP64_EOCD_SIG)) {
      throw new Error(
        "This EPUB file is truncated or corrupt — its ZIP directory is missing, which usually means the download was cut off. Re-download the book and upload it again.",
      );
    }
  } finally {
    await fh.close();
  }
}

export class EpubParser implements BookParser {
  readonly name = "epub";
  readonly extensions = [".epub"];

  async parse(filePath: string): Promise<ParseResult> {
    await assertValidEpub(filePath);

    let epub: EPub;
    try {
      epub = await EPub.createAsync(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // epub2 reports any zip open failure as "Invalid/missing file <path>"
      if (msg.includes("Invalid/missing file")) {
        throw new Error(
          "Could not open the EPUB as a ZIP archive — the file is likely corrupt. Try re-downloading it.",
        );
      }
      throw err;
    }
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
