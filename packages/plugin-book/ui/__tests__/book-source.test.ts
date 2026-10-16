// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { markdownChapters, type MarkdownHeading } from "../book-source.js";

const MD = [
  "Some Book", //                      1  front matter
  "",
  "# Part One", //                     3
  "",
  "## Chapter 1", //                   5
  "Opening paragraph.",
  "### A Section", //                  7
  "Section text.",
  "## Chapter 2", //                   9
  "Second chapter text with a [link](#h7).",
  "## Chapter 3", //                   11
  "Last chapter.",
];

const fetchLines = vi.fn(async (start: number, end: number) => MD.slice(start - 1, end).join("\n"));

const HEADINGS: MarkdownHeading[] = [
  { line: 3, level: 1, title: "Part One" },
  { line: 5, level: 2, title: "Chapter 1" },
  { line: 7, level: 3, title: "A Section" },
  { line: 9, level: 2, title: "Chapter 2" },
  { line: 11, level: 2, title: "Chapter 3" },
];

describe("markdownChapters", () => {
  it("splits at the shallowest heading level that repeats, merging front matter", () => {
    // Level 1 occurs once (a part title), so chapters split at levels 1–2;
    // the front matter joins the first chapter
    const book = markdownChapters(HEADINGS, fetchLines);
    expect(book.spine).toEqual(["md-1", "md-5", "md-9", "md-11"]);
  });

  it("links TOC entries to their chapter, with fragments for inner headings", () => {
    const book = markdownChapters(HEADINGS, fetchLines);
    expect(book.toc.map((t) => [t.title, t.href])).toEqual([
      ["Part One", "md-1#h3"],
      ["Chapter 1", "md-5"],
      ["A Section", "md-5#h7"],
      ["Chapter 2", "md-9"],
      ["Chapter 3", "md-11"],
    ]);
  });

  it("loads a chapter's lines as sanitized HTML with heading anchors", async () => {
    const book = markdownChapters(HEADINGS, fetchLines);
    const first = await book.loadChapter("md-1");
    expect(fetchLines).toHaveBeenCalledWith(1, 4);
    expect(first.heading).toBe("Part One");
    expect(first.html).toContain('id="h3"');

    const ch1 = await book.loadChapter("md-5");
    const root = document.createElement("div");
    root.innerHTML = ch1.html;
    expect(root.querySelector("#h7")).not.toBeNull();
    expect(root.querySelector("h3")?.textContent).toBe("A Section");
    expect(root.textContent).not.toContain("Chapter 2");
    expect(ch1.heading).toBe("Chapter 1");

    const last = await book.loadChapter("md-11");
    expect(last.html).toContain("Last chapter.");
  });

  it("turns in-book links into reader links", async () => {
    const book = markdownChapters(HEADINGS, fetchLines);
    const { html } = await book.loadChapter("md-9");
    expect(html).toContain('data-target="#h7"');
  });

  it("splits at a deeper level when the shallowest one leaves chapters very long", () => {
    // Two parts spanning 4000 lines, each with two chapters
    const parts: MarkdownHeading[] = [
      { line: 1, level: 1, title: "Part I" },
      { line: 10, level: 2, title: "Chapter 1" },
      { line: 1000, level: 2, title: "Chapter 2" },
      { line: 2000, level: 1, title: "Part II" },
      { line: 2010, level: 2, title: "Chapter 3" },
      { line: 3000, level: 2, title: "Chapter 4" },
    ];
    const book = markdownChapters(parts, fetchLines);
    expect(book.spine).toEqual(["md-1", "md-10", "md-1000", "md-2000", "md-2010", "md-3000"]);
  });

  it("treats a book without headings as one chapter", () => {
    const book = markdownChapters([], fetchLines);
    expect(book.spine).toEqual(["md-1"]);
    expect(book.toc).toEqual([]);
  });

  it("rejects unknown chapter keys", async () => {
    await expect(markdownChapters(HEADINGS, fetchLines).loadChapter("md-2")).rejects.toThrow();
  });
});
