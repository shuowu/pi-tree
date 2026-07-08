/**
 * Mermaid stand-in for the export viewer build (see vite.viewer.config.ts).
 *
 * Real mermaid adds ~2.5MB to the single-file export. In exports, diagram
 * sources simply stay visible as code blocks: useMermaid() catches the
 * render rejection and keeps the original <pre> (with .mermaid-error).
 */

const mermaidStub = {
  initialize(): void {
    /* no-op */
  },
  render(): Promise<{ svg: string }> {
    return Promise.reject(new Error("mermaid rendering is disabled in exports"));
  },
};

export default mermaidStub;
