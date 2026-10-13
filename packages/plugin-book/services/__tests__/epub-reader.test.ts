import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTestEpub } from "../../parsers/__tests__/fixtures.js";
import { epubPath, getEpubInfo, parseNavToc, readEpubFile, resolveZipPath } from "../epub-reader.js";

const FIXTURES_DIR = join(import.meta.dirname, ".test-fixtures-reader");
let epubFile: string;

beforeAll(async () => {
  epubFile = await createTestEpub(FIXTURES_DIR);
});

afterAll(async () => {
  await rm(FIXTURES_DIR, { recursive: true, force: true });
});

describe("epub-reader", () => {
  it("lists the spine in reading order", async () => {
    const info = await getEpubInfo(epubFile);
    expect(info.spine).toEqual(["chapter1.xhtml", "chapter2.xhtml"]);
  });

  it("serves files that exist in the archive with a media type", async () => {
    const file = await readEpubFile(epubFile, "chapter1.xhtml");
    expect(file?.mimeType).toBe("application/xhtml+xml");
    expect(file?.data.toString("utf-8")).toContain("<html");
  });

  it("returns null for paths outside the archive", async () => {
    expect(await readEpubFile(epubFile, "../../etc/passwd")).toBeNull();
    expect(await readEpubFile(epubFile, "missing.xhtml")).toBeNull();
  });

  it("rejects source ids that could escape the sources dir", () => {
    expect(epubPath("/data/sources", "..")).toBeNull();
    expect(epubPath("/data/sources", "a/b")).toBeNull();
    expect(epubPath("/data/sources", "my-book")).toBe("/data/sources/my-book/original.epub");
  });

  it("resolves relative zip paths", () => {
    expect(resolveZipPath("EPUB/xhtml/", "../images/a.png")).toBe("EPUB/images/a.png");
    expect(resolveZipPath("EPUB/", "xhtml/c%201.xhtml#n2")).toBe("EPUB/xhtml/c 1.xhtml#n2");
  });

  it("parses an EPUB3 nav toc with nesting", () => {
    const nav = `<nav epub:type="toc"><ol>
      <li><a href="xhtml/p1.xhtml">Part <b>One</b></a><ol>
        <li><a href="xhtml/c1.xhtml#s1">Chapter 1</a></li>
      </ol></li>
      <li><a href="xhtml/c2.xhtml">Chapter 2</a></li>
    </ol></nav><nav epub:type="landmarks"><ol><li><a href="cover.xhtml">Cover</a></li></ol></nav>`;
    expect(parseNavToc(nav, "EPUB/nav.xhtml")).toEqual([
      { title: "Part One", level: 0, href: "EPUB/xhtml/p1.xhtml" },
      { title: "Chapter 1", level: 1, href: "EPUB/xhtml/c1.xhtml#s1" },
      { title: "Chapter 2", level: 0, href: "EPUB/xhtml/c2.xhtml" },
    ]);
  });
});
