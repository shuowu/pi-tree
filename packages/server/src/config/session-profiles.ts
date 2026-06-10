import type { SessionProfile } from "../types/agent.js";

/**
 * Built-in session profiles.
 *
 * Keys follow the pattern `sourceType.mode` for specific profiles,
 * `sourceType` for type-level defaults, and `_default` for the global fallback.
 *
 * Resolution order (first match wins):
 *   1. `${sourceType}.${mode}` — e.g. "book.reading"
 *   2. `${sourceType}` — e.g. "book"
 *   3. `_default`
 */
export const SESSION_PROFILES: Record<string, SessionProfile> = {
  // --- Book profiles ---
  "book.reading": {
    label: "Book Reading",
    skills: ["interactive-reading"],
    extensions: ["mcp"],
    excludeTools: ["bash", "edit"],
  },
  "book.qa": {
    label: "Book Q&A",
    skills: ["interactive-reading"],
    extensions: ["mcp"],
    excludeTools: ["bash", "edit"],
  },
  "book.analysis": {
    label: "Book Analysis",
    skills: ["book-analysis", "book-outline"],
    extensions: ["mcp"],
    excludeTools: ["bash", "edit"],
  },
  "book": {
    label: "Book (Default)",
    skills: ["interactive-reading"],
    extensions: ["mcp"],
    excludeTools: ["bash", "edit"],
  },

  // --- News profiles ---
  "news.news": {
    label: "News Reading",
    skills: ["news-reading"],
    extensions: ["news", "mcp"],
    excludeTools: ["bash", "edit"],
  },
  "news": {
    label: "News (Default)",
    skills: ["news-reading"],
    extensions: ["news", "mcp"],
    excludeTools: ["bash", "edit"],
  },

  // --- Router (source-level, no mode) ---
  "router": {
    label: "Session Router",
    skills: ["session-router"],
    extensions: ["library", "mcp"],
    excludeTools: ["bash", "edit"],
  },

  // --- Global fallback ---
  "_default": {
    label: "Default",
    skills: ["interactive-reading"],
    extensions: ["mcp"],
    excludeTools: ["bash", "edit"],
  },
};
