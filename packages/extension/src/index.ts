// Parser exports for library consumption (web app)
export { registerParser, getParser, getSupportedExtensions } from "./parsers/index.js";
export type { BookParser, ParseResult } from "./parsers/types.js";

// Re-export parser implementations for direct use
export { EpubParser } from "./parsers/epub-parser.js";
export { PdfParser } from "./parsers/pdf-parser.js";
export { MobiParser } from "./parsers/mobi-parser.js";
