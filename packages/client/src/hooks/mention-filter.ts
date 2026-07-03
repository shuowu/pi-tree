/**
 * Pure logic for @-mention filtering and query parsing.
 * Extracted from useSourceMentions for testability (no React, no API deps).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MentionSuggestion {
  id: string;
  /** Display label in dropdown */
  label: string;
  /** Secondary text (author, feed tags, feed count) */
  sublabel?: string;
  /** Source type for icon selection */
  type: string;
  /** Discriminator: category / source / feed / tag */
  kind: "category" | "source" | "feed" | "tag";
  /** Text inserted into the input on selection (includes @) */
  insertText: string;
}

// ---------------------------------------------------------------------------
// filterMentionItems — balanced dropdown + text search
// ---------------------------------------------------------------------------

/**
 * Pure filter logic for mention suggestions.
 *
 * Empty query → balanced mix: categories, tags (high-value), sources, feeds.
 * Non-empty → multi-word AND search across label, sublabel, insertText.
 */
export function filterMentionItems(
  allItems: MentionSuggestion[],
  query: string,
): MentionSuggestion[] {
  if (!query) {
    // Balanced mix: categories + tags first (high-value), then sources, feeds fill rest
    const MAX = 14;
    const categories = allItems.filter((i) => i.kind === "category");
    const tags = allItems.filter((i) => i.kind === "tag").slice(0, 8);
    const sources = allItems.filter((i) => i.kind === "source").slice(0, 4);
    const used = categories.length + tags.length + sources.length;
    const feeds = allItems.filter((i) => i.kind === "feed").slice(0, Math.max(0, MAX - used));
    return [...categories, ...tags, ...sources, ...feeds].slice(0, MAX);
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return allItems.slice(0, 30);
  return allItems
    .filter((item) => {
      const haystack = `${item.label} ${item.sublabel ?? ""} ${item.insertText}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .slice(0, 30);
}

// ---------------------------------------------------------------------------
// parseMentionQuery — cursor-aware @ detection
// ---------------------------------------------------------------------------

/**
 * Parses the @-mention being actively edited at the cursor position.
 * Supports multiple @mentions — finds the one the cursor is inside.
 *
 * Examples:
 *  - "hello @pri|"                → { query: "pri", startIndex: 6 }
 *  - "@Dune compare with @Pri|"   → { query: "Pri", startIndex: 20 }
 *  - "@Dune| compare"             → { query: "Dune", startIndex: 0 }
 *  - "hello|"                     → null
 */
export function parseMentionQuery(
  text: string,
  cursorPos: number,
): { query: string; startIndex: number } | null {
  // Look backwards from cursor for the nearest @
  const beforeCursor = text.slice(0, cursorPos);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex === -1) return null;

  // @ must be at start of input or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(beforeCursor[atIndex - 1])) return null;

  const query = beforeCursor.slice(atIndex + 1);

  return { query, startIndex: atIndex };
}
