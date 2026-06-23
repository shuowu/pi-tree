/**
 * Tests for resolveSystemContextTemplate — the system context template
 * resolver that injects source data and file contents into plugin-defined
 * system prompts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSystemContextTemplate } from "../services/tree-manager.js";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeSourceRow(overrides: Partial<{
  title: string;
  author: string;
  year: number | null;
  metadata: string | null;
}> = {}) {
  return {
    title: overrides.title ?? "Test Book",
    author: overrides.author ?? "Test Author",
    year: overrides.year ?? 2024,
    metadata: overrides.metadata ?? null,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("resolveSystemContextTemplate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pit-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Basic placeholder replacement ──

  it("replaces {sourceId} and {userId}", () => {
    const result = resolveSystemContextTemplate(
      ["Source: {sourceId}", "User: {userId}"],
      "my-book", "alice", null, tmpDir,
    );
    expect(result).toBe("Source: my-book\nUser: alice");
  });

  it("replaces {title}, {author}, {year} from source row", () => {
    const result = resolveSystemContextTemplate(
      ["{title} by {author} ({year})"],
      "src1", "user1",
      makeSourceRow({ title: "Dune", author: "Frank Herbert", year: 1965 }),
      tmpDir,
    );
    expect(result).toBe("Dune by Frank Herbert (1965)");
  });

  it("handles null sourceRow gracefully", () => {
    const result = resolveSystemContextTemplate(
      ["Title: {title}", "ID: {sourceId}"],
      "src1", "user1", null, tmpDir,
    );
    // {title} should remain unresolved (no sourceRow)
    expect(result).toContain("ID: src1");
    expect(result).toContain("{title}");
  });

  it("handles null year gracefully", () => {
    const result = resolveSystemContextTemplate(
      ["Year: {year}"],
      "src1", "user1",
      { title: "Test", author: "Author", year: null, metadata: null },
      tmpDir,
    );
    // {year} should remain as-is when year is null
    expect(result).toBe("Year: {year}");
  });

  // ── Metadata JSON fields ──

  it("replaces metadata JSON fields", () => {
    const result = resolveSystemContextTemplate(
      ["Custom field: {customField}"],
      "src1", "user1",
      makeSourceRow({ metadata: JSON.stringify({ customField: "custom-value" }) }),
      tmpDir,
    );
    expect(result).toBe("Custom field: custom-value");
  });

  it("source-level fields take precedence over metadata fields", () => {
    // If metadata has a "title" key, the source row's title should win
    const result = resolveSystemContextTemplate(
      ["Title: {title}"],
      "src1", "user1",
      makeSourceRow({ title: "Source Title", metadata: JSON.stringify({ title: "Metadata Title" }) }),
      tmpDir,
    );
    expect(result).toBe("Title: Source Title");
  });

  it("handles malformed metadata JSON gracefully", () => {
    const result = resolveSystemContextTemplate(
      ["ID: {sourceId}"],
      "src1", "user1",
      makeSourceRow({ metadata: "not-valid-json" }),
      tmpDir,
    );
    // Should not throw, just skip metadata
    expect(result).toBe("ID: src1");
  });

  // ── Multiple placeholders on one line ──

  it("replaces multiple placeholders on the same line", () => {
    const result = resolveSystemContextTemplate(
      ["Source ID: {sourceId} | Title: {title} | Author: {author}"],
      "principles", "shuo",
      makeSourceRow({ title: "Principles", author: "Ray Dalio" }),
      tmpDir,
    );
    expect(result).toBe("Source ID: principles | Title: Principles | Author: Ray Dalio");
  });

  it("replaces the same placeholder appearing multiple times", () => {
    const result = resolveSystemContextTemplate(
      ["{sourceId}/markdown/ and {sourceId}/analysis/"],
      "my-book", "user1", null, tmpDir,
    );
    expect(result).toBe("my-book/markdown/ and my-book/analysis/");
  });

  // ── {file:path} injection ──

  it("injects file contents for {file:path}", () => {
    // Create a file in the source directory
    const analysisDir = join(tmpDir, "analysis");
    mkdirSync(analysisDir, { recursive: true });
    writeFileSync(join(analysisDir, "toc.json"), '[{"line":1,"title":"Chapter 1"}]');

    const result = resolveSystemContextTemplate(
      ["TOC:", "{file:analysis/toc.json}"],
      "src1", "user1", null, tmpDir,
    );
    expect(result).toBe('TOC:\n[{"line":1,"title":"Chapter 1"}]');
  });

  it("returns '(not available)' for missing files", () => {
    const result = resolveSystemContextTemplate(
      ["{file:analysis/toc.json}"],
      "src1", "user1", null, tmpDir,
    );
    expect(result).toBe("(not available)");
  });

  it("truncates files exceeding 16 KB", () => {
    mkdirSync(join(tmpDir, "data"), { recursive: true });
    const bigContent = "x".repeat(20 * 1024); // 20 KB
    writeFileSync(join(tmpDir, "data", "big.txt"), bigContent);

    const result = resolveSystemContextTemplate(
      ["{file:data/big.txt}"],
      "src1", "user1", null, tmpDir,
    );
    expect(result).toContain("...(truncated)");
    // Should be 16 KB + truncation message
    expect(result.length).toBeLessThan(bigContent.length);
    expect(result.startsWith("x".repeat(100))).toBe(true);
  });

  it("handles {file:path} inline with other text", () => {
    mkdirSync(join(tmpDir, "notes"), { recursive: true });
    writeFileSync(join(tmpDir, "notes", "info.txt"), "hello");

    const result = resolveSystemContextTemplate(
      ["Before {file:notes/info.txt} after"],
      "src1", "user1", null, tmpDir,
    );
    expect(result).toBe("Before hello after");
  });

  it("handles multiple {file:...} on the same line", () => {
    mkdirSync(join(tmpDir, "a"), { recursive: true });
    writeFileSync(join(tmpDir, "a", "x.txt"), "X");
    writeFileSync(join(tmpDir, "a", "y.txt"), "Y");

    const result = resolveSystemContextTemplate(
      ["{file:a/x.txt} and {file:a/y.txt}"],
      "src1", "user1", null, tmpDir,
    );
    expect(result).toBe("X and Y");
  });

  // ── Combined: source fields + file injection ──

  it("resolves source fields and file injection together", () => {
    const analysisDir = join(tmpDir, "analysis");
    mkdirSync(analysisDir, { recursive: true });
    writeFileSync(join(analysisDir, "toc.json"), '[{"line":42,"title":"Intro"}]');

    const result = resolveSystemContextTemplate(
      [
        "[BOOK SESSION]",
        "Title: {title} | Author: {author}",
        "",
        "TOC:",
        "{file:analysis/toc.json}",
      ],
      "my-book", "alice",
      makeSourceRow({ title: "Dune", author: "Frank Herbert" }),
      tmpDir,
    );

    const lines = result.split("\n");
    expect(lines[0]).toBe("[BOOK SESSION]");
    expect(lines[1]).toBe("Title: Dune | Author: Frank Herbert");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("TOC:");
    expect(lines[4]).toBe('[{"line":42,"title":"Intro"}]');
  });

  // ── Edge cases ──

  it("returns empty string for empty template array", () => {
    const result = resolveSystemContextTemplate(
      [], "src1", "user1", null, tmpDir,
    );
    expect(result).toBe("");
  });

  it("preserves lines with no placeholders", () => {
    const result = resolveSystemContextTemplate(
      ["Static line with no placeholders.", "Another static line."],
      "src1", "user1", null, tmpDir,
    );
    expect(result).toBe("Static line with no placeholders.\nAnother static line.");
  });

  it("leaves unresolved placeholders as-is", () => {
    const result = resolveSystemContextTemplate(
      ["{unknownPlaceholder}"],
      "src1", "user1", null, tmpDir,
    );
    expect(result).toBe("{unknownPlaceholder}");
  });
});
