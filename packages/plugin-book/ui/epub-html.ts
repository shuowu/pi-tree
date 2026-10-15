/**
 * Turns a raw EPUB chapter (XHTML) into safe, theme-neutral HTML for the
 * in-app reader. Runs in the browser (DOMParser).
 *
 * - Allowlist sanitizer: drops scripts/styles/forms, strips the book's inline
 *   styles (fixed px sizes and black text break the app themes) but keeps
 *   centered/right alignment as classes.
 * - Rewrites image sources to the plugin's file route and tags internal links
 *   with their resolved zip path so the reader can navigate or show notes.
 * - Footnote references become numbered superscript markers.
 */

/** Elements removed together with their content */
const DROP = new Set([
  "script", "style", "link", "meta", "title", "head", "iframe", "object", "embed",
  "form", "input", "button", "textarea", "select", "noscript", "template",
  "audio", "video", "canvas", "math",
]);

/** Elements kept as-is (unknown elements are unwrapped, keeping their children) */
const KEEP = new Set([
  "p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img", "em", "i", "b",
  "strong", "u", "s", "sub", "sup", "br", "hr", "blockquote", "ul", "ol", "li", "dl",
  "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "figure",
  "figcaption", "pre", "code", "section", "article", "aside", "header", "footer", "small",
  "big", "cite", "q", "abbr", "ruby", "rt", "rp", "del", "ins", "mark", "center",
]);

const NOTE_TYPES = /\b(footnote|endnote|rearnote|note)\b/;

export interface ProcessedChapter {
  html: string;
  /** First heading text, used when the TOC has no entry for this chapter */
  heading: string | null;
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i + 1) : "";
}

/** Resolve a relative href against a zip directory, normalizing ./ and ../ */
export function resolvePath(dir: string, href: string): string {
  const hashAt = href.indexOf("#");
  const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const frag = hashAt >= 0 ? href.slice(hashAt) : "";
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    /* keep raw */
  }
  const out: string[] = [];
  for (const part of (dir + decoded).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/") + frag;
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function alignClass(style: string | null): string | null {
  const m = style?.match(/text-align\s*:\s*(center|right)/i);
  return m ? `epub-align-${m[1].toLowerCase()}` : null;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * Parse a chapter into an HTML document. EPUB chapters are XHTML, where
 * `<script/>` or `<a id="x"/>` are self-closing; the HTML parser ignores the
 * slash and swallows everything after them (Kobo kepubs put `<script/>` in
 * every <head>). So parse as XML first, falling back to HTML for chapters
 * that aren't well-formed namespaced XHTML.
 */
function parseChapter(raw: string): Document {
  const xml = new DOMParser().parseFromString(raw, "application/xhtml+xml");
  const xmlBody = xml.getElementsByTagNameNS(XHTML_NS, "body")[0];
  if (!xmlBody || xml.getElementsByTagName("parsererror").length > 0) {
    return new DOMParser().parseFromString(raw, "text/html");
  }
  // Move the body into an HTML document so serialization and tag names
  // behave as HTML downstream.
  const doc = document.implementation.createHTMLDocument("");
  for (const child of Array.from(xmlBody.childNodes)) {
    doc.body.appendChild(doc.importNode(child, true));
  }
  return doc;
}

export function processChapter(
  rawHtml: string,
  chapterPath: string,
  fileUrl: (zipPath: string) => string,
): ProcessedChapter {
  const doc = parseChapter(rawHtml);
  const dir = dirOf(chapterPath);
  const body = doc.body;

  // SVG-wrapped images (common for covers): <svg><image xlink:href> → <img>
  for (const svg of Array.from(body.querySelectorAll("svg"))) {
    const image = svg.querySelector("image");
    const href = image?.getAttribute("xlink:href") ?? image?.getAttribute("href");
    if (href) {
      const img = doc.createElement("img");
      img.setAttribute("src", href);
      svg.replaceWith(img);
    } else {
      svg.remove();
    }
  }

  clean(body, doc, dir, fileUrl);

  // Footnote references → numbered markers
  let n = 0;
  for (const a of Array.from(body.querySelectorAll<HTMLAnchorElement>("a[data-target]"))) {
    if (!a.hasAttribute("data-note") && !a.querySelector("img[data-note-icon]")) continue;
    a.setAttribute("data-note", "");
    n++;
    const text = a.textContent?.trim() ?? "";
    const hasImg = a.querySelector("img") !== null;
    // Image-only or blank markers get a number; short textual markers (1, [2], *) stay
    if (hasImg || text === "" || text.length > 6) {
      a.textContent = String(n);
    }
    a.classList.add("epub-noteref");
    if (a.parentElement?.tagName !== "SUP") {
      const sup = doc.createElement("sup");
      a.replaceWith(sup);
      sup.appendChild(a);
    }
  }

  const heading = body.querySelector("h1, h2, h3")?.textContent?.replace(/\s+/g, " ").trim() || null;
  return { html: body.innerHTML, heading };
}

function clean(
  node: Element,
  doc: Document,
  dir: string,
  fileUrl: (zipPath: string) => string,
): void {
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase();
    if (DROP.has(tag)) {
      child.remove();
      continue;
    }
    clean(child, doc, dir, fileUrl);
    if (!KEEP.has(tag)) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    sanitizeAttributes(child, tag, dir, fileUrl);
  }
}

function sanitizeAttributes(
  el: Element,
  tag: string,
  dir: string,
  fileUrl: (zipPath: string) => string,
): void {
  const attrs = new Map(Array.from(el.attributes).map((a) => [a.name.toLowerCase(), a.value]));
  for (const name of Array.from(el.attributes).map((a) => a.name)) el.removeAttribute(name);

  const id = attrs.get("id");
  if (id) el.setAttribute("id", id);
  for (const keep of ["lang", "xml:lang", "dir", "colspan", "rowspan"]) {
    const v = attrs.get(keep);
    if (v) el.setAttribute(keep === "xml:lang" ? "lang" : keep, v);
  }
  const epubType = attrs.get("epub:type") ?? attrs.get("role");
  if (epubType) el.setAttribute("data-epub-type", epubType.replace(/^doc-/, ""));
  const align = alignClass(attrs.get("style") ?? null) ?? (tag === "center" ? "epub-align-center" : null);
  if (align) el.classList.add(align);

  if (tag === "img") {
    const src = attrs.get("src");
    if (src && !isExternal(src)) el.setAttribute("src", fileUrl(resolvePath(dir, src)));
    else if (src?.startsWith("data:image/")) el.setAttribute("src", src);
    el.setAttribute("alt", attrs.get("alt") ?? "");
    el.setAttribute("loading", "lazy");
    if (/footnote|note/i.test(attrs.get("class") ?? "")) el.setAttribute("data-note-icon", "");
  }

  if (tag === "a") {
    const href = attrs.get("href");
    if (!href) return;
    if (isExternal(href)) {
      if (/^https?:/i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      return;
    }
    // Internal link: the reader handles the click (navigate or show the note)
    // A bare "#frag" stays as-is: it points into the current chapter
    const target = href.startsWith("#") ? href : resolvePath(dir, href);
    // No href: a "#" would leak into the app URL. The reader handles click/Enter.
    el.setAttribute("data-target", target);
    el.setAttribute("role", "link");
    el.setAttribute("tabindex", "0");
    const cls = attrs.get("class") ?? "";
    if ((epubType && /noteref/.test(epubType)) || /footnote|noteref/i.test(cls)) {
      el.setAttribute("data-note", "");
    }
  }
}

/** True when the element that a link points at looks like a note body */
export function isNoteElement(el: Element): boolean {
  const type = el.getAttribute("data-epub-type") ?? "";
  if (NOTE_TYPES.test(type)) return true;
  return el.closest('aside, [data-epub-type~="footnote"], [data-epub-type~="endnote"], [data-epub-type~="footnotes"], [data-epub-type~="endnotes"], [data-epub-type~="rearnote"]') !== null;
}

/** The block to show in a note popover for a link target */
export function noteBlock(target: Element): Element {
  return target.closest("aside, li, p, dd, div") ?? target;
}
