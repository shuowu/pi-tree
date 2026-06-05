import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import type { BookParser, ParseResult } from "./types.js";

export class PdfParser implements BookParser {
  readonly name = "pdf";
  readonly extensions = [".pdf"];

  async parse(filePath: string): Promise<ParseResult> {
    const buffer = await readFile(filePath);
    const pdf = new PDFParse({ data: new Uint8Array(buffer) });

    const info = await pdf.getInfo();
    const textResult = await pdf.getText();

    const metadata: ParseResult["metadata"] = {
      title: info.info?.Title ?? undefined,
      author: info.info?.Author ?? undefined,
    };

    // Try to structure the text by splitting on chapter-like headings
    const raw = textResult.text ?? "";
    const chapterPattern = /^(Chapter\s+\d+[.:]\s*.+|PART\s+[IVXLCDM\d]+[.:]\s*.+)/gim;
    const lines = raw.split("\n");
    const sections: string[] = [];
    let currentSection: string[] = [];

    for (const line of lines) {
      if (chapterPattern.test(line)) {
        if (currentSection.length > 0) {
          sections.push(currentSection.join("\n"));
        }
        currentSection = [`## ${line.trim()}`];
        chapterPattern.lastIndex = 0;
      } else {
        currentSection.push(line);
      }
    }
    if (currentSection.length > 0) {
      sections.push(currentSection.join("\n"));
    }

    const markdown = sections.join("\n\n---\n\n");

    await pdf.destroy();

    return { markdown, metadata };
  }
}
