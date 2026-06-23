/**
 * Centralized marked configuration — imported once to apply KaTeX + link
 * extensions globally. All components that use `marked.parse()` get LaTeX
 * rendering for free.
 *
 * Import this module (side-effect) before any `marked.parse()` call.
 */
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import "katex/dist/katex.min.css";

// KaTeX extension — handles $...$ (inline) and $$...$$ (block) math
marked.use(
  markedKatex({
    throwOnError: false, // renders error message instead of crashing
  }),
);

// Open external links in new tabs
marked.use({
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : "";
      if (href && !href.startsWith("#")) {
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      }
      return `<a href="${href}"${titleAttr}>${text}</a>`;
    },
  },
});
