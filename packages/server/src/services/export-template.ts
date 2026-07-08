/**
 * Standalone HTML export — snapshot injection into the viewer template.
 *
 * The viewer is the client's own React components, built as a single
 * self-contained HTML file (packages/client/vite.viewer.config.ts →
 * dist/viewer.html). Exports therefore always look and behave like the app.
 *
 * At export time this module loads that template and injects the sanitized
 * session snapshot as `window.__PI_TREE__` (plus the document title).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionSnapshot } from "./export-service.js";

/**
 * Locate the built viewer template. Checked in order:
 * 1. PI_TREE_VIEWER_TEMPLATE — explicit override
 * 2. CLIENT_DIST_PATH/viewer.html — Docker / Electron (set by main.ts)
 * 3. Module-relative packages/client/dist/viewer.html — repo layout (dev + build)
 * 4. cwd-relative packages/client/dist/viewer.html — run from repo root
 */
export function resolveViewerTemplatePath(): string | null {
  const candidates = [
    process.env.PI_TREE_VIEWER_TEMPLATE,
    process.env.CLIENT_DIST_PATH
      ? join(process.env.CLIENT_DIST_PATH, "viewer.html")
      : undefined,
    join(import.meta.dirname, "../../../client/dist/viewer.html"),
    join(process.cwd(), "packages/client/dist/viewer.html"),
  ].filter((p): p is string => !!p);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function renderExportHtml(snapshot: SessionSnapshot): string {
  const templatePath = resolveViewerTemplatePath();
  if (!templatePath) {
    throw new Error(
      "Export viewer not built — run: npm run build:viewer -w @pi-tree/client",
    );
  }
  const template = readFileSync(templatePath, "utf-8");

  // <-escape so "</script>" inside message content can't terminate the block
  const json = JSON.stringify(snapshot).replace(/</g, "\\u003c");
  const title = escapeHtml(`${snapshot.session.title} — ${snapshot.source.title}`);

  // The snapshot script must run before the bundle; inline classic scripts in
  // <head> execute during parse, while the bundle is a deferred module.
  return template
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace(/<head>/i, `<head><script>window.__PI_TREE__ = ${json};</script>`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
