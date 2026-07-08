/**
 * Entry point for the standalone export viewer (see vite.viewer.config.ts).
 * Renders the snapshot the server injected as `window.__PI_TREE__`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { Viewer, type ViewerSnapshot } from "./Viewer";

declare global {
  interface Window {
    __PI_TREE__?: ViewerSnapshot;
  }
}

// Follow the OS color scheme using the app's themes (sepia / dark-ink)
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  if (darkQuery.matches) {
    document.documentElement.setAttribute("data-theme", "dark-ink");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}
applyTheme();
darkQuery.addEventListener("change", applyTheme);

const snapshot = window.__PI_TREE__;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {snapshot ? (
      <Viewer snapshot={snapshot} />
    ) : (
      <div className="viewer-no-snapshot">
        This file has no embedded session snapshot — export it from pi-tree.
      </div>
    )}
  </StrictMode>,
);
