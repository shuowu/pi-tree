/**
 * Highlights in rendered chapter HTML. An anchor stores the highlighted text
 * plus a little context on each side; positions are offsets into the
 * chapter's text (the concatenated text nodes), so they survive re-renders of
 * the same HTML and re-locate by content if offsets drift.
 */

import type { BookHighlight } from "@pi-tree/ui";

type MemoAnchor = BookHighlight["anchor"];
export type HighlightColor = MemoAnchor["color"];

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"];

/** Context kept on each side of the highlighted text */
const CONTEXT_CHARS = 32;
const MARK_CLASS = "book-hl";

/** Offset of a DOM boundary point within root's text */
function textOffset(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** Build an anchor for a selection inside root; null when it's empty or outside root. */
export function anchorFromRange(
  root: HTMLElement,
  range: Range,
  chapter: string,
  color: HighlightColor,
): MemoAnchor | null {
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = root.textContent ?? "";
  let start = textOffset(root, range.startContainer, range.startOffset);
  let end = textOffset(root, range.endContainer, range.endOffset);
  // Don't let stray whitespace at the edges into the highlight
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start >= end) return null;
  return {
    kind: "book",
    chapter,
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
    color,
  };
}

/** Length of the shared run at the end of a and b */
function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Find an anchor's text in root: every occurrence of the exact text, picking
 * the one whose surroundings best match the saved context.
 */
export function locateAnchor(root: HTMLElement, anchor: MemoAnchor): [number, number] | null {
  const text = root.textContent ?? "";
  let best: [number, number] | null = null;
  let bestScore = -1;
  for (let i = text.indexOf(anchor.exact); i >= 0; i = text.indexOf(anchor.exact, i + 1)) {
    const end = i + anchor.exact.length;
    const score =
      commonSuffix(text.slice(Math.max(0, i - anchor.prefix.length), i), anchor.prefix) +
      commonPrefix(text.slice(end, end + anchor.suffix.length), anchor.suffix);
    if (score > bestScore) {
      best = [i, end];
      bestScore = score;
    }
  }
  return best;
}

/** Wrap root's text between two offsets in marks (one per text node it spans). */
export function paintHighlight(
  root: HTMLElement,
  [start, end]: [number, number],
  id: number,
  color: HighlightColor,
): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: Array<{ node: Text; from: number; to: number }> = [];
  let pos = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const len = node.data.length;
    const from = Math.max(start, pos) - pos;
    const to = Math.min(end, pos + len) - pos;
    // Whitespace-only runs sit between blocks; wrapping them adds nothing
    if (from < to && node.data.slice(from, to).trim()) segments.push({ node, from, to });
    pos += len;
    if (pos >= end) break;
  }
  for (const { node, from, to } of segments) {
    const middle = from > 0 ? node.splitText(from) : node;
    if (to - from < middle.data.length) middle.splitText(to - from);
    const mark = document.createElement("mark");
    mark.className = `${MARK_CLASS} ${MARK_CLASS}-${color}`;
    mark.dataset.hlId = String(id);
    middle.replaceWith(mark);
    mark.appendChild(middle);
  }
}

/** Remove every highlight mark, restoring the original text nodes. */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll(`mark.${MARK_CLASS}`);
  if (marks.length === 0) return;
  for (const mark of Array.from(marks)) mark.replaceWith(...Array.from(mark.childNodes));
  root.normalize();
}

/** Repaint a chapter's highlights; returns the ids that couldn't be located. */
export function paintHighlights(root: HTMLElement, highlights: BookHighlight[]): number[] {
  clearHighlights(root);
  const missing: number[] = [];
  for (const h of highlights) {
    const at = locateAnchor(root, h.anchor);
    if (at) paintHighlight(root, at, h.id, h.anchor.color);
    else missing.push(h.id);
  }
  return missing;
}

/** The highlight id of a mark the event target sits in, if any */
export function highlightIdAt(target: EventTarget | null): number | null {
  const mark = (target as Element | null)?.closest?.(`mark.${MARK_CLASS}`);
  const id = mark ? Number((mark as HTMLElement).dataset.hlId) : NaN;
  return Number.isFinite(id) ? id : null;
}
