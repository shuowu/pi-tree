import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getParser, getSupportedExtensions, registerParser } from "../index.js";
import { EpubParser } from "../epub-parser.js";
import { PdfParser } from "../pdf-parser.js";
import { MobiParser } from "../mobi-parser.js";
import type { BookParser, ParseResult } from "../types.js";
import { createTestEpub, createTestPdf } from "./fixtures.js";

const FIXTURES_DIR = join(import.meta.dirname, ".test-fixtures");

beforeAll(async () => {
  await createTestEpub(FIXTURES_DIR);
  await createTestPdf(FIXTURES_DIR);
});

afterAll(async () => {
  await rm(FIXTURES_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("parser registry", () => {
  it("routes .epub to EpubParser", () => {
    const p = getParser("book.epub");
    expect(p).toBeTruthy();
    expect(p!.name).toBe("epub");
  });

  it("routes .pdf to PdfParser", () => {
    const p = getParser("book.pdf");
    expect(p).toBeTruthy();
    expect(p!.name).toBe("pdf");
  });

  it("routes .mobi/.azw/.azw3 to MobiParser", () => {
    for (const ext of [".mobi", ".azw", ".azw3"]) {
      const p = getParser(`book${ext}`);
      expect(p).toBeTruthy();
      expect(p!.name).toBe("mobi");
    }
  });

  it("returns null for unsupported extensions", () => {
    expect(getParser("file.txt")).toBeNull();
    expect(getParser("file.docx")).toBeNull();
    expect(getParser("file")).toBeNull();
  });

  it("getSupportedExtensions includes all built-in formats", () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain(".epub");
    expect(exts).toContain(".pdf");
    expect(exts).toContain(".mobi");
    expect(exts).toContain(".azw");
    expect(exts).toContain(".azw3");
  });

  it("allows registering a custom parser", () => {
    const custom: BookParser = {
      name: "custom",
      extensions: [".custom"],
      async parse(): Promise<ParseResult> {
        return { markdown: "custom", metadata: {} };
      },
    };
    registerParser(custom);
    const p = getParser("file.custom");
    expect(p).toBeTruthy();
    expect(p!.name).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// EPUB Parser
// ---------------------------------------------------------------------------

describe("EpubParser", () => {
  const parser = new EpubParser();

  it("parses a minimal EPUB and extracts markdown", async () => {
    const filePath = join(FIXTURES_DIR, "test-book.epub");
    const result = await parser.parse(filePath);

    expect(result.markdown).toBeTruthy();
    expect(result.markdown.length).toBeGreaterThan(50);
    // Should contain converted chapter content
    expect(result.markdown).toContain("Introduction");
    expect(result.markdown).toContain("Conclusion");
    // HTML should be converted — bold/italic as markdown
    expect(result.markdown).toContain("**bold text**");
    // Turndown uses underscores for <em> by default
    expect(result.markdown).toContain("_italic text_");
  });

  it("extracts metadata from EPUB", async () => {
    const filePath = join(FIXTURES_DIR, "test-book.epub");
    const result = await parser.parse(filePath);

    expect(result.metadata.title).toBe("Test Book");
    expect(result.metadata.author).toBe("Test Author");
    expect(result.metadata.language).toBe("en");
  });

  it("throws on missing file", async () => {
    await expect(
      parser.parse("/nonexistent/file.epub"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PDF Parser
// ---------------------------------------------------------------------------

describe("PdfParser", () => {
  const parser = new PdfParser();

  it("parses a minimal PDF and extracts text", async () => {
    const filePath = join(FIXTURES_DIR, "test-book.pdf");
    const result = await parser.parse(filePath);

    expect(result.markdown).toBeTruthy();
    expect(result.markdown).toContain("Hello World Test Content");
  });

  it("extracts metadata from PDF info dict", async () => {
    const filePath = join(FIXTURES_DIR, "test-book.pdf");
    const result = await parser.parse(filePath);

    // pdf-parse extracts Title/Author from the info dictionary
    expect(result.metadata.title).toBe("Test PDF Book");
    expect(result.metadata.author).toBe("PDF Test Author");
  });

  it("throws on missing file", async () => {
    await expect(
      parser.parse("/nonexistent/file.pdf"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MOBI Parser
// ---------------------------------------------------------------------------

describe("MobiParser", () => {
  const parser = new MobiParser();

  it("has correct extensions", () => {
    expect(parser.extensions).toContain(".mobi");
    expect(parser.extensions).toContain(".azw");
    expect(parser.extensions).toContain(".azw3");
  });

  it("throws on invalid MOBI data", async () => {
    // Create a dummy file that's not valid MOBI
    const { writeFile } = await import("node:fs/promises");
    const badPath = join(FIXTURES_DIR, "bad.mobi");
    await writeFile(badPath, "not a real mobi file");

    await expect(parser.parse(badPath)).rejects.toThrow();
  });
});
