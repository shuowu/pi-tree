// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  anchorFromRange,
  clearHighlights,
  highlightIdAt,
  locateAnchor,
  paintHighlights,
} from "../highlight-dom.js";

const HTML =
  "<h1>Step 1</h1><p>Index funds <em>win</em> over time.</p>" +
  "<p>The lesson: index funds win. Later, index funds win again.</p>";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("article");
  root.innerHTML = HTML;
  document.body.replaceChildren(root);
});

/** Range over the nth occurrence of text in root */
function rangeOf(text: string, nth = 0): Range {
  const full = root.textContent!;
  let at = -1;
  for (let i = 0; i <= nth; i++) at = full.indexOf(text, at + 1);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (at >= pos && at <= pos + len) range.setStart(n, at - pos);
    if (at + text.length >= pos && at + text.length <= pos + len) {
      range.setEnd(n, at + text.length - pos);
      break;
    }
    pos += len;
  }
  return range;
}

describe("highlight anchors", () => {
  it("captures text across inline elements with context", () => {
    const anchor = anchorFromRange(root, rangeOf("funds win over"), "ch1", "yellow")!;
    expect(anchor).toMatchObject({ chapter: "ch1", exact: "funds win over", color: "yellow" });
    expect(anchor.prefix.endsWith("Step 1Index ")).toBe(true);
    expect(anchor.suffix.startsWith(" time.")).toBe(true);
  });

  it("trims whitespace at the edges and rejects empty selections", () => {
    expect(anchorFromRange(root, rangeOf(" over "), "ch1", "yellow")!.exact).toBe("over");
    expect(anchorFromRange(root, rangeOf(" "), "ch1", "yellow")).toBeNull();
  });

  it("re-locates the right occurrence of repeated text by its context", () => {
    const second = anchorFromRange(root, rangeOf("index funds win", 1), "ch1", "yellow")!;
    const at = locateAnchor(root, second)!;
    expect(root.textContent!.slice(at[0], at[1])).toBe("index funds win");
    expect(root.textContent!.slice(at[1], at[1] + 7)).toBe(" again.");
  });

  it("returns null when the text is gone", () => {
    expect(locateAnchor(root, { kind: "book", chapter: "c", exact: "missing", prefix: "", suffix: "", color: "blue" })).toBeNull();
  });
});

describe("painting", () => {
  it("wraps a highlight spanning elements, and clears back to the original HTML", () => {
    const anchor = anchorFromRange(root, rangeOf("funds win over"), "ch1", "green")!;
    const missing = paintHighlights(root, [{ id: 7, anchor }]);
    expect(missing).toEqual([]);
    const marks = root.querySelectorAll("mark.book-hl");
    expect(Array.from(marks).map((m) => m.textContent).join("")).toBe("funds win over");
    expect(marks[0].classList.contains("book-hl-green")).toBe(true);
    expect(highlightIdAt(marks[1].firstChild!.parentElement)).toBe(7);

    clearHighlights(root);
    expect(root.innerHTML).toBe(HTML);
  });

  it("repaints idempotently and reports highlights it can't place", () => {
    const anchor = anchorFromRange(root, rangeOf("The lesson"), "ch1", "pink")!;
    const gone = { ...anchor, exact: "not in this chapter" };
    paintHighlights(root, [{ id: 1, anchor }]);
    const missing = paintHighlights(root, [{ id: 1, anchor }, { id: 2, anchor: gone }]);
    expect(missing).toEqual([2]);
    expect(root.querySelectorAll("mark.book-hl")).toHaveLength(1);
  });
});
