import { Hono } from "hono";
import type { PluginRouteContext, PluginSetupResult } from "@pi-tree/plugin-sdk";
import { PaperDiscoverProvider } from "./discover.js";

/**
 * The paper plugin is otherwise extension-only. This minimal setup exists so the
 * paper DiscoverProvider is registered once at boot (extensions load lazily
 * per-session, which is the wrong time to register a reading-list provider).
 */
export function setup(ctx: PluginRouteContext): PluginSetupResult {
  ctx.discover.registerProvider(new PaperDiscoverProvider());
  return { routes: new Hono() };
}
