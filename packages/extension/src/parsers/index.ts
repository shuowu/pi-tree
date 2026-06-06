import { type BookParser } from "./types.js";
import { EpubParser } from "./epub-parser.js";
import { PdfParser } from "./pdf-parser.js";
import { MobiParser } from "./mobi-parser.js";
import { extname } from "node:path";

const parsers: Map<string, BookParser> = new Map();

export function registerParser(parser: BookParser): void {
  for (const ext of parser.extensions) {
    parsers.set(ext.toLowerCase(), parser);
  }
}

export function getParser(filename: string): BookParser | null {
  const ext = extname(filename).toLowerCase();
  return parsers.get(ext) ?? null;
}

export function getSupportedExtensions(): string[] {
  return [...parsers.keys()];
}

// Register built-in parsers
registerParser(new EpubParser());
registerParser(new PdfParser());
registerParser(new MobiParser());

export type { BookParser, ParseResult } from "./types.js";
