/**
 * Pi-Tree Client Configuration (PayloadCMS-style)
 *
 * Central config file — the single source of truth for installed plugins.
 * Each plugin is a factory function that returns a ClientPlugin descriptor.
 * Add or remove plugins here to change what's available in the app.
 */
import { defineConfig } from "./config";

// ---- Plugin imports ----
import { newsPlugin } from "pi-tree-news/ui/plugin";
import { bookPlugin } from "pi-tree-book/ui/plugin";
import { youtubePlugin } from "pi-tree-youtube/ui/plugin";

// ---- Resolve config ----
export default defineConfig([
  bookPlugin(),
  newsPlugin(),
  youtubePlugin(),
]);
