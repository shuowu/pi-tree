/**
 * Runtime plugin UI loader.
 *
 * Fetches the UI manifest from the server and loads plugin bundles at runtime
 * via <script> tag injection. Plugin bundles are built as IIFEs that read
 * shared deps from window.__piTreeDeps and register themselves on
 * window.__piTreePlugins.
 *
 * This is the runtime counterpart to the static pi-tree.config.ts imports.
 * For core plugins bundled in the client, pi-tree.config.ts is sufficient.
 * For external/user plugins installed at $DATA_PATH/extensions/, this is
 * the only way to load their UI.
 */
import type { ClientPlugin } from "@pi-tree/ui";

// -- Shared dependency shim --------------------------------------------------
// Expose host app copies of React, lucide-react, and @pi-tree/ui so that
// dynamically loaded plugin IIFE bundles can reference them as globals.
// The esbuild build script maps `import 'react'` → `window.__piTreeDeps.react`.

import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as LucideReact from "lucide-react";
import * as PiTreeUI from "@pi-tree/ui";

declare global {
  interface Window {
    __piTreeDeps: Record<string, unknown>;
    __piTreePlugins: Record<string, Record<string, unknown>>;
  }
}

window.__piTreeDeps = {
  react: React,
  "react/jsx-runtime": ReactJsxRuntime,
  "react/jsx-dev-runtime": ReactJsxRuntime, // alias for dev builds
  "lucide-react": LucideReact,
  "@pi-tree/ui": PiTreeUI,
};

// Plugin registry — IIFE bundles write here via their globalName
window.__piTreePlugins = window.__piTreePlugins || {};

// -- Script loader ------------------------------------------------------------

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
}

// -- Public API ---------------------------------------------------------------

interface PluginManifestEntry {
  name: string;
  sourceType: string;
  bundleUrl: string;
}

/**
 * Load plugin UI bundles at runtime.
 * Returns an array of ClientPlugin descriptors ready to merge into the app config.
 *
 * Call this early (e.g. in main.tsx). It's non-blocking — the app can render
 * immediately and plugins will appear when they finish loading.
 */
export async function loadPluginUI(): Promise<ClientPlugin[]> {
  try {
    const res = await fetch("/api/config/plugins/ui-manifest");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { plugins: PluginManifestEntry[] } = await res.json();

    if (data.plugins.length === 0) return [];

    const plugins: ClientPlugin[] = [];
    for (const entry of data.plugins) {
      try {
        await loadScript(entry.bundleUrl);
        const mod = window.__piTreePlugins[entry.name];
        if (!mod) {
          console.warn(
            `[plugin-loader] Plugin "${entry.name}" loaded but didn't register`,
          );
          continue;
        }
        // Find the factory function — plugins export e.g. bookPlugin(), newsPlugin()
        const factory = Object.values(mod).find(
          (v) => typeof v === "function",
        ) as (() => ClientPlugin) | undefined;
        if (factory) {
          plugins.push(factory());
          console.log(`[plugin-loader] Loaded UI for "${entry.name}"`);
        } else {
          console.warn(
            `[plugin-loader] Plugin "${entry.name}" has no callable export`,
          );
        }
      } catch (err) {
        console.warn(
          `[plugin-loader] Failed to load "${entry.name}":`,
          err,
        );
      }
    }
    return plugins;
  } catch (err) {
    console.warn("[plugin-loader] Failed to fetch manifest:", err);
    return [];
  }
}
