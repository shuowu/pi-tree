import { Hono } from "hono";
import { getAgentRegistry } from "../services/agent-registry.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const configRoutes = new Hono();

/**
 * GET /api/config/source-types
 * Returns all discovered source type configs from plugins.
 * Used by the client to populate SOURCE_TYPE_CONFIGS dynamically.
 */
configRoutes.get("/source-types", (c) => {
  const registry = getAgentRegistry();
  const sourceTypes = registry.getSourceTypes();
  return c.json({ sourceTypes });
});

/**
 * GET /api/config/plugins/ui-manifest
 * Returns which plugins have pre-built UI bundles available.
 * The client uses this to dynamically load plugin UI at runtime.
 */
configRoutes.get("/plugins/ui-manifest", (c) => {
  const registry = getAgentRegistry();
  const sourceTypes = registry.getSourceTypes();
  const plugins = sourceTypes
    .filter((st) => st.hasUI)
    .filter((st) => {
      // Only include plugins whose UI bundles actually exist on disk
      const bundlePath = join(st.pluginDir, "ui", "dist", "plugin.js");
      return existsSync(bundlePath);
    })
    .map((st) => ({
      name: st.pluginName,
      sourceType: st.key,
      bundleUrl: `/api/config/plugins/${st.pluginName}/ui/plugin.js`,
    }));
  return c.json({ plugins });
});

/**
 * GET /api/config/plugins/:name/ui/*
 * Serves pre-built plugin UI bundles (JS/CSS/source maps).
 * Looks up the plugin directory from the agent registry.
 */
configRoutes.get("/plugins/:name/ui/*", (c) => {
  const pluginName = c.req.param("name");
  const filePath = c.req.path.split(`/plugins/${pluginName}/ui/`)[1];
  if (!filePath) return c.text("Not found", 404);

  // Prevent path traversal
  if (filePath.includes("..")) return c.text("Forbidden", 403);

  const registry = getAgentRegistry();
  const sourceType = registry
    .getSourceTypes()
    .find((st) => st.pluginName === pluginName);
  if (!sourceType) return c.text("Plugin not found", 404);

  const fullPath = join(sourceType.pluginDir, "ui", "dist", filePath);
  if (!existsSync(fullPath)) return c.text("Not found", 404);

  const content = readFileSync(fullPath);
  const ext = filePath.split(".").pop();
  const contentType =
    ext === "js"
      ? "application/javascript"
      : ext === "css"
        ? "text/css"
        : ext === "map"
          ? "application/json"
          : "application/octet-stream";
  return c.body(content, 200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
  });
});
