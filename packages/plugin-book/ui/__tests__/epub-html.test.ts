// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isNoteElement, noteBlock, processChapter, resolvePath } from "../epub-html.js";

const fileUrl = (p: string) => `/files?path=${p}`;

function render(body: string, path = "EPUB/xhtml/ch1.xhtml") {
  const { html, heading } = processChapter(
    `<?xml version="1.0"?><html xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title>
     <link rel="stylesheet" href="../css/a.css"/><style>p{color:red}</style></head><body>${body}</body></html>`,
    path,
    fileUrl,
  );
  const root = document.createElement("div");
  root.innerHTML = html;
  return { root, heading, html };
}

describe("processChapter", () => {
  it("strips scripts, styles, event handlers and inline styles", () => {
    const { html } = render(
      `<p style="font-size:16px;color:rgb(0,0,0)" onclick="alert(1)">Hi<script>alert(2)</script></p>
       <iframe src="x"></iframe><a href="javascript:alert(3)">x</a>`,
    );
    expect(html).not.toMatch(/script|onclick|style=|iframe|javascript:|color:red/);
    expect(html).toContain("Hi");
  });

  it("keeps centered alignment as a class", () => {
    const { root } = render(`<h1><span style="display:block;text-align:center;">Title</span></h1>`);
    expect(root.querySelector("span")?.className).toBe("epub-align-center");
  });

  it("rewrites image sources to the file route", () => {
    const { root } = render(`<p><img src="../images/fig%201.png" alt="Fig"/></p>`);
    expect(root.querySelector("img")?.getAttribute("src")).toBe("/files?path=EPUB/images/fig 1.png");
  });

  it("turns image noterefs into numbered markers and tags note asides", () => {
    const { root } = render(`
      <aside epub:type="footnote" id="fn1">A note.</aside>
      <p>Text<sup><a epub:type="noteref" href="#fn1"><img src="../images/n.png" class="epub-footnote" alt="A note."/></a></sup>
      and more<a epub:type="noteref" href="#fn1"><img src="../images/n.png" alt=""/></a></p>`);
    const refs = root.querySelectorAll("a.epub-noteref");
    expect(refs).toHaveLength(2);
    expect(refs[0].textContent).toBe("1");
    expect(refs[1].textContent).toBe("2");
    expect(refs[1].parentElement?.tagName).toBe("SUP");
    expect(refs[0].getAttribute("data-target")).toBe("#fn1");
    const aside = root.querySelector("#fn1")!;
    expect(aside.getAttribute("data-epub-type")).toBe("footnote");
    expect(isNoteElement(aside)).toBe(true);
    expect(noteBlock(aside).textContent).toContain("A note.");
  });

  it("resolves cross-chapter links and keeps external links external", () => {
    const { root } = render(`<p><a href="ch2.xhtml#s3">next</a> <a href="https://example.com">web</a></p>`);
    const [internal, external] = Array.from(root.querySelectorAll("a"));
    expect(internal.getAttribute("data-target")).toBe("EPUB/xhtml/ch2.xhtml#s3");
    expect(internal.hasAttribute("href")).toBe(false);
    expect(external.getAttribute("target")).toBe("_blank");
  });

  it("reports the first heading", () => {
    expect(render(`<h1><b>永</b><b>不</b>知足</h1><p>x</p>`).heading).toBe("永不知足");
  });

  it("converts svg-wrapped cover images to img", () => {
    const { root } = render(
      `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/cover.jpg"/></svg>`,
    );
    expect(root.querySelector("img")?.getAttribute("src")).toBe("/files?path=EPUB/images/cover.jpg");
  });
});

describe("resolvePath", () => {
  it("normalizes ./ and ../ and keeps fragments", () => {
    expect(resolvePath("A/B/", "./../C/d.xhtml#x")).toBe("A/C/d.xhtml#x");
  });
});
