import { useEffect, useRef } from "react";
import mermaid from "mermaid";

let mermaidInitialized = false;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    // Prevent mermaid from auto-scanning on import
    suppressErrors: true,
    fontFamily: "inherit",
  });
  mermaidInitialized = true;
}

let renderCounter = 0;

/**
 * Post-processes a container ref to render any `<code class="language-mermaid">`
 * blocks produced by `marked` into SVG diagrams.
 *
 * Call this hook in any component that uses `dangerouslySetInnerHTML` with
 * `marked.parse()` output. Pass the same ref used on the container element.
 *
 * @param containerRef - ref to the DOM element containing rendered markdown
 * @param html - the parsed HTML string (used as a dependency to re-run on content change)
 * @param enabled - set to false to skip rendering (e.g. during active streaming)
 */
export function useMermaid(
  containerRef: React.RefObject<HTMLElement | null>,
  html: string,
  enabled: boolean = true,
) {
  // Track whether this component instance is still mounted
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    // Find all <pre><code class="language-mermaid"> blocks
    const codeBlocks = container.querySelectorAll<HTMLElement>(
      "pre > code.language-mermaid",
    );
    if (codeBlocks.length === 0) return;

    ensureMermaidInit();

    // Render each block
    for (const codeEl of codeBlocks) {
      const pre = codeEl.parentElement;
      if (!pre || pre.dataset.mermaidRendered === "true") continue;

      const source = codeEl.textContent?.trim();
      if (!source) continue;

      // Mark immediately to prevent double-render
      pre.dataset.mermaidRendered = "true";

      const id = `mermaid-${++renderCounter}`;

      mermaid
        .render(id, source)
        .then(({ svg }) => {
          if (!mountedRef.current) return;
          // Replace the <pre><code> with the rendered SVG
          const wrapper = document.createElement("div");
          wrapper.className = "mermaid-diagram";
          wrapper.innerHTML = svg;
          pre.replaceWith(wrapper);
        })
        .catch((err) => {
          console.warn("Mermaid render failed:", err);
          // On failure, show original code with an error indicator
          pre.classList.add("mermaid-error");
        });
    }
  }, [html, enabled, containerRef]);
}

