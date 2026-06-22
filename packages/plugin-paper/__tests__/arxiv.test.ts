/**
 * Unit tests for arXiv service pure functions.
 *
 * Tests normalizeArxivId (ID extraction from various formats)
 * and parseArxivEntries (Atom XML parsing).
 */
import { describe, it, expect } from "vitest";
import { normalizeArxivId, parseArxivEntries } from "../services/arxiv.js";

// ---------------------------------------------------------------------------
// normalizeArxivId
// ---------------------------------------------------------------------------

describe("normalizeArxivId", () => {
  it("passes through a raw ID unchanged", () => {
    expect(normalizeArxivId("2301.07041")).toBe("2301.07041");
  });

  it("strips version suffix", () => {
    expect(normalizeArxivId("2301.07041v2")).toBe("2301.07041");
  });

  it("extracts ID from abstract URL", () => {
    expect(normalizeArxivId("https://arxiv.org/abs/2301.07041")).toBe("2301.07041");
  });

  it("extracts ID from PDF URL", () => {
    expect(normalizeArxivId("https://arxiv.org/pdf/2301.07041")).toBe("2301.07041");
  });

  it("extracts ID from PDF URL with .pdf extension", () => {
    expect(normalizeArxivId("https://arxiv.org/pdf/2301.07041.pdf")).toBe("2301.07041");
  });

  it("strips version from URL", () => {
    expect(normalizeArxivId("https://arxiv.org/abs/2301.07041v3")).toBe("2301.07041");
  });

  it("handles old-style category IDs", () => {
    expect(normalizeArxivId("hep-ph/9901000")).toBe("hep-ph/9901000");
  });

  it("handles http (non-https) URLs", () => {
    expect(normalizeArxivId("http://arxiv.org/abs/2301.07041")).toBe("2301.07041");
  });
});

// ---------------------------------------------------------------------------
// parseArxivEntries
// ---------------------------------------------------------------------------

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
  <entry>
    <id>http://arxiv.org/abs/2301.07041v1</id>
    <title>Attention Is All You Need (Revisited)</title>
    <summary>We revisit the transformer architecture and propose improvements to multi-head attention.</summary>
    <author><name>John Smith</name></author>
    <author><name>Jane Doe</name></author>
    <published>2023-01-17T12:00:00Z</published>
    <updated>2023-01-18T12:00:00Z</updated>
    <category term="cs.AI" />
    <category term="cs.CL" />
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.</summary>
    <author><name>Ashish Vaswani</name></author>
    <published>2017-06-12T17:57:34Z</published>
    <updated>2023-08-02T00:41:18Z</updated>
    <category term="cs.CL" />
    <category term="cs.LG" />
  </entry>
</feed>`;

describe("parseArxivEntries", () => {
  it("parses correct number of entries", () => {
    const entries = parseArxivEntries(SAMPLE_XML);
    expect(entries).toHaveLength(2);
  });

  it("extracts arXiv ID without version", () => {
    const entries = parseArxivEntries(SAMPLE_XML);
    expect(entries[0].arxivId).toBe("2301.07041");
    expect(entries[1].arxivId).toBe("1706.03762");
  });

  it("extracts title with normalized whitespace", () => {
    const entries = parseArxivEntries(SAMPLE_XML);
    expect(entries[0].title).toBe("Attention Is All You Need (Revisited)");
  });

  it("extracts all authors", () => {
    const entries = parseArxivEntries(SAMPLE_XML);
    expect(entries[0].authors).toEqual(["John Smith", "Jane Doe"]);
    expect(entries[1].authors).toEqual(["Ashish Vaswani"]);
  });

  it("extracts categories", () => {
    const entries = parseArxivEntries(SAMPLE_XML);
    expect(entries[0].categories).toEqual(["cs.AI", "cs.CL"]);
  });

  it("builds correct URLs", () => {
    const entries = parseArxivEntries(SAMPLE_XML);
    expect(entries[0].pdfUrl).toBe("https://arxiv.org/pdf/2301.07041");
    expect(entries[0].abstractUrl).toBe("https://arxiv.org/abs/2301.07041");
    expect(entries[0].ar5ivUrl).toBe("https://ar5iv.labs.arxiv.org/html/2301.07041");
  });

  it("extracts dates", () => {
    const entries = parseArxivEntries(SAMPLE_XML);
    expect(entries[0].published).toBe("2023-01-17T12:00:00Z");
    expect(entries[0].updated).toBe("2023-01-18T12:00:00Z");
  });

  it("returns empty array for XML with no entries", () => {
    const xml = `<?xml version="1.0"?><feed><title>Empty</title></feed>`;
    expect(parseArxivEntries(xml)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseArxivEntries("")).toEqual([]);
  });
});
